/**
 * The link that actually goes in the email.
 *
 * NOT `generateLink()`'s `action_link`, which is what this used to send and
 * why following a key never once worked. That URL points at Supabase's own
 * `/auth/v1/verify`, which verifies the token and then redirects to us with the
 * session in the URL **fragment** — and a fragment is never sent to a server.
 * So `/auth/callback` saw no `token_hash`, did nothing, and redirected. The
 * only reason anybody ever had a session was that signup consumes a second,
 * separate link server-side; the emailed one was decorative.
 *
 * Supabase's own guidance for sending your own email is exactly this: take
 * `properties.hashed_token` and build the URL yourself, so the token arrives at
 * your route as a query parameter and `verifyOtp` can set the cookie the way
 * every other server-side read expects to find it.
 */

export type KeyType = 'magiclink' | 'signup' | 'recovery' | 'invite' | 'email_change' | 'email'

/**
 * Origins this deployment is allowed to send somebody back to.
 *
 * `URL` and `DEPLOY_PRIME_URL` are set by Netlify, not by the caller — that is
 * the whole point of reading them. The alternative, trusting the request's own
 * `Host` header, is account takeover with extra steps: post a signup for
 * somebody else's address with a forged Host and they are emailed a working key
 * pointing at your server.
 */
function trustedOrigins(): string[] {
  const raw = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
    process.env.DEPLOY_URL,
  ]

  const origins: string[] = []
  for (const value of raw) {
    if (!value) continue
    try {
      const origin = new URL(value).origin
      if (!origins.includes(origin)) origins.push(origin)
    } catch {
      // A malformed value is worth ignoring rather than crashing signup over.
    }
  }
  return origins
}

/** Where the request actually came from, as the platform reported it. */
function requestOrigin(request: Request | undefined): string | null {
  if (!request) return null
  try {
    const forwarded = request.headers.get('x-forwarded-proto')
    const host = request.headers.get('host')
    if (host) return `${forwarded ?? 'https'}://${host}`
    return new URL(request.url).origin
  } catch {
    return null
  }
}

/**
 * The origin a key should point at.
 *
 * Takes the request, because the link's entire job is to bring somebody back to
 * **the site they are using** — and a build-time constant cannot know that. It
 * being a constant is what let a deploy on a custom domain email links to its
 * `netlify.app` address: you clicked, the callback ran on the other origin, the
 * session cookie was set there, and back on the real site you were still a
 * stranger being asked for a name you had already chosen.
 *
 * The request origin wins only if the platform vouches for it. If it does not,
 * the configured URL is used and the mismatch is logged — an emailed link to
 * the wrong host is not something to let pass in silence.
 */
export function siteUrl(request?: Request): string {
  const trusted = trustedOrigins()
  const asked = requestOrigin(request)

  if (asked && trusted.includes(asked)) return asked

  const fallback = trusted[0] ?? 'http://localhost:3000'
  if (asked && asked !== fallback) {
    console.warn(
      `[thewall] a key was requested from ${asked}, which is not a known origin for this deploy. ` +
        `sending it to ${fallback} instead. set NEXT_PUBLIC_SITE_URL to the address people actually use, and redeploy.`,
    )
  }
  return fallback
}

export function verifyUrl(
  hashedToken: string,
  type: KeyType = 'magiclink',
  request?: Request,
): string {
  const url = new URL('/auth/callback', siteUrl(request))
  url.searchParams.set('token_hash', hashedToken)
  url.searchParams.set('type', type)
  return url.toString()
}

/**
 * A base nobody can reach, so anything that resolves onto it is a path.
 *
 * Thrown away after parsing. It exists to give `new URL` something to resolve
 * against, and to be recognisable afterwards — see `landingPath`.
 */
const NOWHERE = 'http://parse.invalid'

/**
 * Where a followed key lands, from a `next` somebody else supplied.
 *
 * **The check happens after parsing, and that is the whole of it.** The version
 * before this tested the string as it arrived — starts with `/`, does not start
 * with `//` — and `?next=/..//evil.example` passes both. The URL parser then
 * resolves the `..` away and leaves a *pathname* of `//evil.example`, which a
 * browser reads as protocol-relative and follows off-site. Every failure path
 * in the callback redirects too, so no valid token was needed: a crafted link
 * to `/auth/callback` was the whole exploit, on the one route people reach by
 * clicking something in an email.
 *
 * There was a test. It had its own copy of the guard and tried four hostile
 * inputs, all of them the ones somebody writing the guard would think of — so
 * it agreed with the code about a rule that was wrong. The function lives here
 * now and both the route and the test import it, because a copy is free to be
 * correct on its own.
 *
 * So: parse first, then ask what came out. A `next` that names a host of its
 * own lands on a different origin; one that resolves into a host afterwards
 * shows up as a pathname beginning `//`. Anything else is ours.
 */
export function landingPath(next: string, params: Record<string, string> = {}): string {
  let target: URL
  try {
    target = new URL(next, NOWHERE)
    if (target.origin !== NOWHERE || target.pathname.startsWith('//')) {
      target = new URL('/', NOWHERE)
    }
  } catch {
    // Not a URL at all. `new URL` throws on some inputs and a thrown parse is
    // not a reason to 500 on somebody following a link from their inbox.
    target = new URL('/', NOWHERE)
  }

  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value)
  return `${target.pathname}${target.search}`
}
