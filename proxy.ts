import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Keeps the session alive across requests.
 *
 * `proxy.ts`, not `middleware.ts`: Next 16 renamed the convention and warns on
 * every build about the old name.
 *
 * `@supabase/ssr` stores the session in cookies and refreshes the access token
 * by writing new ones. Without something doing that on every request, the token
 * expires after an hour and the *server* stops recognising anybody: the shell
 * boots, `getUser()` returns nothing, and a person who signed up an hour ago is
 * quietly a guest again — asked their name a second time for an account they
 * already have.
 *
 * There was no middleware at all, which is the piece of the SSR setup that is
 * easiest to skip because nothing fails immediately. It fails an hour later,
 * to somebody who is not looking at the code.
 *
 * Calling `getUser()` is the whole job. It validates the token with Supabase
 * and, when it has been refreshed, the cookie writes below carry the new one
 * back on the response.
 */
export default async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Fixtures mode, or a deployment with no project wired up yet. There is no
  // session to refresh and nothing here should be what tells them so.
  if (!url || !key) return NextResponse.next({ request })

  let response = NextResponse.next({ request })

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        // Written twice on purpose: once onto the request, so anything running
        // after this in the same pass sees the refreshed session, and once onto
        // a fresh response, which is what actually reaches the browser.
        for (const { name, value } of list) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of list) response.cookies.set(name, value, options)
      },
    },
  })

  try {
    await supabase.auth.getUser()
  } catch {
    // Supabase being unreachable must not take the site down with it. Reading
    // is anonymous (§3.9), so the worst case here is being a guest for a moment.
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except the things that never carry a session: Next's own
     * assets, and the generated images. The share cards especially — they are
     * fetched by crawlers, they have no cookies, and putting an auth round trip
     * in front of one only makes a preview slower.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon|opengraph-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
