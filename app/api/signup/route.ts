import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { suggestAlternates, validateName } from '@/lib/auth/names'
import { createAdminClient, createRouteClient } from '@/lib/supabase/server'

/**
 * The server half of §3.9.
 *
 * GET  /api/signup?name=x  — is this name free, and if not, what is?
 * POST /api/signup         — create the account, mint the key, sign them in.
 *
 * There is no form on the other end of this; the prompt asks one question per
 * line and posts the answers here.
 */

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get('name') ?? ''
  const validated = validateName(name)
  if (!validated.ok) {
    return NextResponse.json({ available: false, alternates: [] })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('profiles')
    .select('name')
    .ilike('name', `${validated.name}%`)

  if (error) {
    return NextResponse.json({ error: 'could not check that name' }, { status: 500 })
  }

  const taken = new Set((data ?? []).map((row) => row.name.toLowerCase()))
  const available = !taken.has(validated.name)

  return NextResponse.json({
    available,
    alternates: available ? [] : suggestAlternates(validated.name, taken),
  })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { name?: string; email?: string } | null
  if (!body?.name || !body?.email) {
    return NextResponse.json({ error: 'a name and an email, please' }, { status: 400 })
  }

  const validated = validateName(body.name)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.reason }, { status: 400 })
  }

  const admin = createAdminClient()

  // §4.7 — the bound that makes unverified posting survivable at launch. The
  // check and the write are one call, so a burst cannot slip between them.
  const { data: withinLimit, error: limitError } = await admin.rpc('record_signup_attempt', {
    p_client_hash: clientHash(request),
  })

  if (limitError) {
    return NextResponse.json({ error: 'something went wrong signing you up' }, { status: 500 })
  }
  if (withinLimit === false) {
    return NextResponse.json(
      { error: 'that’s a lot of new accounts from one place. try again in an hour.' },
      { status: 429 },
    )
  }

  // email_confirm marks the address as confirmed without the round trip, which
  // is exactly the §4.7 trade: posting works immediately, the key arrives in
  // parallel, and throwaway addresses get in. Revisit when the manual kill
  // switch stops being practical.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: body.email,
    email_confirm: true,
  })

  if (createError || !created.user) {
    return NextResponse.json(
      { error: createError?.message ?? 'could not create that account' },
      { status: 400 },
    )
  }

  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id: created.user.id, name: validated.name })

  if (profileError) {
    // Don't leave an auth user with no profile behind; it would hold the email
    // hostage on a retry.
    await admin.auth.admin.deleteUser(created.user.id)
    const taken = profileError.code === '23505'
    return NextResponse.json(
      { error: taken ? `${validated.name} was taken a moment ago.` : 'could not create that account' },
      { status: taken ? 409 : 500 },
    )
  }

  // Their key, for getting back in later. Two links are minted because the
  // second one is consumed immediately below to start this session, and a
  // consumed link would be useless in their inbox.
  const { data: keyLink } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: body.email,
    options: { redirectTo: `${siteUrl()}/auth/callback` },
  })

  if (keyLink?.properties?.action_link) {
    // No email provider in scope. The link goes to the server log, which is
    // where you read it in development; swapping in a sender is one call.
    console.log(`\n  magic link for ${body.email}:\n  ${keyLink.properties.action_link}\n`)
  }

  const { data: sessionLink, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: body.email,
  })

  if (linkError || !sessionLink?.properties?.hashed_token) {
    return NextResponse.json({ error: 'could not sign you in' }, { status: 500 })
  }

  // Consuming a link server-side is what puts the session in the cookie, so the
  // held sentence can post right now rather than after a trip to an inbox.
  const supabase = await createRouteClient()
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: 'email',
    token_hash: sessionLink.properties.hashed_token,
  })

  if (verifyError) {
    return NextResponse.json({ error: 'could not sign you in' }, { status: 500 })
  }

  return NextResponse.json({ name: validated.name })
}

/**
 * Hashed, not stored: the rate limit needs to tell callers apart, not identify
 * them, and a plain address on disk is a liability with no upside.
 */
function clientHash(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? ''
  const address = forwarded.split(',')[0]?.trim() || 'unknown'
  return createHash('sha256').update(address).digest('hex')
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
}
