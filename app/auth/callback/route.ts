import { NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase/server'

/**
 * Where the magic link lands when someone comes back later (§3.9).
 *
 * The link is a key, not a gate: signup already signed them in, so this exists
 * for the next visit rather than the first one.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const tokenHash = url.searchParams.get('token_hash')
  const next = url.searchParams.get('next') ?? '/'

  if (!tokenHash) {
    return NextResponse.redirect(new URL('/', url.origin))
  }

  const supabase = await createRouteClient()
  const { error } = await supabase.auth.verifyOtp({ type: 'email', token_hash: tokenHash })

  // A spent or expired link is not worth an error page — it just means reading
  // as a guest, which is the normal state of this site anyway.
  return NextResponse.redirect(new URL(error ? '/' : next, url.origin))
}
