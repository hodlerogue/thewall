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
  await supabase
    .from('profiles')
    .update({ verified_at: new Date().toISOString() })
    .eq('id', data.user.id)
    .is('verified_at', null)

  return NextResponse.redirect(new URL(next, url.origin))
}
