import { NextResponse } from 'next/server'
import { sendMagicLink } from '@/lib/auth/mail'
import { createAdminClient, createRouteClient } from '@/lib/supabase/server'

/**
 * Another key, for when the first one expired or never arrived.
 *
 * "Verify to keep posting" is only fair if asking again is trivial, and links
 * expire — so this is not a nicety, it is the other half of the rule.
 */
export async function POST() {
  const supabase = await createRouteClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    return NextResponse.json({ error: 'you’re not signed in.' }, { status: 401 })
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
  const { data: link, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
    options: { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/auth/callback` },
  })

  if (error || !link?.properties?.action_link) {
    return NextResponse.json({ error: 'couldn’t make a new key just now.' }, { status: 500 })
  }

  const delivery = await sendMagicLink(user.email, link.properties.action_link)
  return NextResponse.json({ note: delivery.note })
}
