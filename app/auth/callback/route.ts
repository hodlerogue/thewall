import { NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase/server'

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

  if (!tokenHash) {
    return NextResponse.redirect(new URL('/', url.origin))
  }

  const supabase = await createRouteClient()
  const { data, error } = await supabase.auth.verifyOtp({ type: 'email', token_hash: tokenHash })

  // A spent or expired link is not worth an error page — it just means reading
  // as a guest, which is the normal state of this site anyway.
  if (error || !data.user) {
    return NextResponse.redirect(new URL('/', url.origin))
  }

  // They can read the inbox. That is the claim §4.7 needs, and now it is true.
  //
  // Through an RPC rather than a direct update: writing this column from the
  // user's own session required a table-wide UPDATE grant, and that grant let
  // anyone set verified_at from the browser console — bypassing the entire
  // gate. security definer + auth.uid() means a caller can only mark
  // themselves, and the grant is gone.
  const { error: markError } = await supabase.rpc('mark_verified')

  if (markError) {
    /*
     * This used to log and redirect as though nothing had happened, on the
     * reasoning that "the next link will mark them". That reasoning is wrong:
     * the next link runs this same call and fails the same way, so the person
     * is in a loop with no exit and no signal — click the link, come back,
     * still be told to click the link.
     *
     * It is also the exact shape of an unapplied migration. `mark_verified` is
     * created by 20260804000000_column_scoped_grants.sql; without it PostgREST
     * answers PGRST202, and the only symptom anybody could see was a gate that
     * would not open.
     */
    console.error(
      `could not mark verified — ${markError.code ?? 'no code'}: ${markError.message}` +
        (markError.code === 'PGRST202'
          ? '\n  mark_verified() does not exist on this project. Apply the migrations: ./scripts/db-deploy.sh'
          : ''),
    )
    return NextResponse.redirect(withOutcome(next, url.origin, 'failed'))
  }

  // Said out loud, because until now following the link produced no feedback of
  // any kind: you clicked, you landed, and nothing on the page had changed.
  return NextResponse.redirect(withOutcome(next, url.origin, 'ok'))
}

/**
 * The landing path, carrying what happened to the key.
 *
 * A query parameter rather than a cookie or a redirect to a dedicated page:
 * §3.4 makes the path the prompt's location, so verification cannot have a
 * page of its own without inventing a place that is not a place. The shell
 * reads this once on boot and strips it, leaving the address it should have.
 */
function withOutcome(next: string, origin: string, outcome: 'ok' | 'failed'): URL {
  const target = new URL(next, origin)
  target.searchParams.set('key', outcome)
  return target
}
