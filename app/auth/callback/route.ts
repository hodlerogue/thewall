import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { landingPath } from '@/lib/auth/links'
import { createAdminClient, createRouteClient } from '@/lib/supabase/server'

/**
 * Where the magic link lands.
 *
 * This is the only place `verified_at` is ever set, and that is the whole point
 * of it: it records that someone followed a link which arrived in that inbox,
 * which is a narrower and truer claim than GoTrue's confirmed flag can make
 * (signup mints a session immediately, and doing so confirms the address as a
 * side effect — see the migration).
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const tokenHash = url.searchParams.get('token_hash')
  const next = url.searchParams.get('next') ?? '/'

  // The type the token was minted as. It used to be hardcoded to 'email' while
  // the links were generated as magiclink, which is the sort of mismatch that
  // fails quietly and looks like an expired link.
  const type = (url.searchParams.get('type') ?? 'magiclink') as EmailOtpType

  // Nothing to verify. Reachable by anyone who opens the bare path, and — until
  // the links were built by hand — by everybody, since Supabase's own
  // action_link comes back with the session in a fragment the server cannot see.
  if (!tokenHash) {
    return backTo(next, 'expired')
  }

  const supabase = await createRouteClient()
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })

  if (error || !data.user) {
    // Spent, expired, or already used. Not an error page — reading as a guest
    // is the normal state of this site — but it has to be said, because a link
    // that silently does nothing is indistinguishable from one that worked.
    console.error(`could not verify a key — ${error?.message ?? 'no user returned'}`)
    return backTo(next, 'expired')
  }

  // They can read the inbox. That is the claim §4.7 needs, and now it is true.
  //
  // Under the service role, and naming the user, rather than through their own
  // session. The session version was `rpc('mark_verified')` with no arguments,
  // granted to `authenticated` — which meant anyone signed in could call it and
  // be verified without ever opening the email. Everyone is signed in from the
  // moment they pick a name, so that was the entire gate, one console line
  // wide. This route is the right caller precisely because it has just watched
  // a token minted for that address be spent.
  const { error: markError } = await createAdminClient().rpc('mark_verified', {
    p_user: data.user.id,
  })

  if (markError) {
    /*
     * This used to log and redirect as though nothing had happened, on the
     * reasoning that "the next link will mark them". That reasoning is wrong:
     * the next link runs this same call and fails the same way, so the person
     * is in a loop with no exit and no signal — click the link, come back,
     * still be told to click the link.
     *
     * It is also the exact shape of an unapplied migration. `mark_verified` is
     * created by 20260804000000_column_scoped_grants.sql and re-signatured by
     * 20260812020000_grants_are_a_denylist.sql; without either, PostgREST
     * answers PGRST202, and the only symptom anybody could see was a gate that
     * would not open.
     */
    console.error(
      `could not mark verified — ${markError.code ?? 'no code'}: ${markError.message}` +
        (markError.code === 'PGRST202'
          ? '\n  mark_verified(p_user uuid) does not exist on this project. Apply the migrations: ./scripts/db-deploy.sh'
          : ''),
    )
    return backTo(next, 'failed')
  }

  // Said out loud, because until now following the link produced no feedback of
  // any kind: you clicked, you landed, and nothing on the page had changed.
  return backTo(next, 'ok')
}

type KeyOutcome = 'ok' | 'failed' | 'expired'

/**
 * Back to where they were, carrying what happened to the key.
 *
 * The outcome travels as a query parameter rather than a cookie or a page of
 * its own: §3.4 makes the path the prompt's location, so verification cannot
 * have a page without inventing a place that is not a place. The shell reads it
 * once on boot and strips it, leaving the address it should have.
 *
 * **The Location header is relative, and that is the fix for a real bug.** This
 * used to redirect to `new URL(next, url.origin)`, where `url` came from
 * `request.url` — and inside a route handler on Netlify that is the *internal*
 * deploy URL, not the address the person typed. So a key that correctly said
 * `thewall.social` in the email bounced, on being followed, to a
 * deploy-scoped `…--site.netlify.app` host that appears in no configuration
 * anywhere: the session cookie was set over there, and the real site still did
 * not know them.
 *
 * A relative Location cannot get the host wrong because it never names one —
 * the browser resolves it against the URL it actually requested. There is no
 * configuration that makes this right or wrong, which is the point.
 */
function backTo(next: string, outcome: KeyOutcome): NextResponse {
  /*
   * `next` arrives from the query string, so it is somebody else's input, and
   * the sanitising lives in `landingPath` — with the reason it is written the
   * way it is, which is that the obvious version of this guard had a hole.
   */
  return new NextResponse(null, {
    status: 303,
    headers: { Location: landingPath(next, { key: outcome }) },
  })
}
