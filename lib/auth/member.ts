/**
 * Whether this browser has signed in here before — decided from cookies alone.
 *
 * Used by the front door to choose between the marketing page and the prompt.
 * Asked for as "the primary marketing page before you've logged in": somebody
 * new should see what this is, and somebody who already has an account should
 * not have to walk past a pitch every time they come back.
 *
 * Presence, not validity. Checking the session properly is a round trip to
 * Supabase on every visit to the bare domain, which is the one URL that has to
 * be fast. Getting it wrong costs little either way: an expired session sends
 * somebody into the prompt, where they are a guest and `login <name>` is one
 * line; a missing one shows them the marketing page, whose button is the way in.
 * Nothing is authorised by this — it only picks a page.
 *
 * `@supabase/ssr` keeps the session in `sb-<project>-auth-token`, split into
 * `.0`, `.1` … when it is too big for one cookie. Not the `-code-verifier`
 * cookie, which exists half-way through a sign-in and means nothing yet.
 */
export function hasSession(cookies: readonly { name: string; value: string }[]): boolean {
  return cookies.some((cookie) => SESSION.test(cookie.name) && cookie.value !== '')
}

const SESSION = /^sb-.+-auth-token(\.\d+)?$/
