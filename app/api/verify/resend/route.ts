import { NextResponse } from 'next/server'
import { sendMagicLink } from '@/lib/auth/mail'
import { verifyUrl } from '@/lib/auth/links'
import { clientHash } from '@/lib/auth/clientHash'
import { createAdminClient, createRouteClient } from '@/lib/supabase/server'

/**
 * Another key, for when the first one expired or never arrived.
 *
 * "Verify to keep posting" is only fair if asking again is trivial, and links
 * expire — so this is not a nicety, it is the other half of the rule.
 */
export async function POST(request: Request) {
  const supabase = await createRouteClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    /*
     * The person most likely to type `resend` is the person whose session is
     * broken, so this is the message they will actually see — and "you're not
     * signed in." on its own is the §3.7 failure exactly: true, useless, and
     * with nothing to do next.
     *
     * There is no way to send without a session. The address has to come from
     * somewhere the caller cannot choose, or this becomes a way to mail a
     * stranger a key from our sending domain. So the fix offered is the one
     * that actually works: say something, which starts the flow again.
     */
    return NextResponse.json(
      {
        error:
          'this browser isn’t signed in, so i don’t know where to send it. say something and i’ll ask for your address again — if the name is already yours, use the same one.',
      },
      { status: 401 },
    )
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('verified_at')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.verified_at) {
    return NextResponse.json({ note: 'you’re already verified — nothing to send.' })
  }

  const admin = createAdminClient()

  // Every call here mints a link and sends real mail. Unbounded, that is a
  // loop that burns the provider's daily quota in a minute — and because
  // signup never proves address ownership, it can be aimed at a stranger's
  // inbox from our sending domain. Three an hour is plenty for "it didn't
  // arrive"; it is nowhere near enough to be a weapon.
  const { data: withinLimit, error: limitError } = await admin.rpc('record_attempt', {
    p_kind: 'resend',
    p_client_hash: clientHash(request),
    p_limit: 3,
  })

  if (limitError) {
    return NextResponse.json({ error: 'couldn’t send just now.' }, { status: 500 })
  }
  if (withinLimit === false) {
    return NextResponse.json(
      { error: 'that’s a lot of keys. try again in an hour — check spam meanwhile.' },
      { status: 429 },
    )
  }

  const { data: link, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  })

  if (error || !link?.properties?.hashed_token) {
    return NextResponse.json({ error: 'couldn’t make a new key just now.' }, { status: 500 })
  }

  // Our own URL, not `action_link` — see lib/auth/links.ts.
  const delivery = await sendMagicLink(
    user.email,
    verifyUrl(link.properties.hashed_token, 'magiclink', request),
  )
  return NextResponse.json({ note: delivery.note })
}
