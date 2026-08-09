import { NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase/server'

/**
 * Leaving, on a device you would rather not stay signed in on.
 *
 * There was no way to do this at all. Nothing in the codebase called `signOut`,
 * and the cookie `@supabase/ssr` writes lasts four hundred days — so signing in
 * on a borrowed phone was a four-hundred-day decision made by somebody who
 * thought they were reading a website.
 *
 * Server-side rather than from the browser client, matching how the session was
 * created: signup mints it here and hands it back as `Set-Cookie`, so this is
 * the half that can reliably clear it. A browser-only `signOut` leaves whatever
 * the server wrote, and the next page load reads it back.
 *
 * `scope: 'local'` — this browser, not every device. Somebody stepping off a
 * shared laptop should not be signing themselves out of their own phone, and
 * the person who *does* want everything closed has a bigger problem than a
 * command can solve.
 */
export async function POST() {
  const supabase = await createRouteClient()

  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) {
    /*
     * Reported, not swallowed. "You are signed out" when the cookie is still
     * there is the worst answer available here: somebody walks away from a
     * shared machine believing something that is not true.
     */
    console.error('logout failed', error)
    return NextResponse.json({ error: 'couldn’t sign you out just now.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
