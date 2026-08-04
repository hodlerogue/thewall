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

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
}

export function verifyUrl(hashedToken: string, type: KeyType = 'magiclink'): string {
  const url = new URL('/auth/callback', siteUrl())
  url.searchParams.set('token_hash', hashedToken)
  url.searchParams.set('type', type)
  return url.toString()
}
