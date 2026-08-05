import { NextResponse } from 'next/server'
import { suggestAlternates, validateName } from '@/lib/auth/names'
import { clientHash } from '@/lib/auth/clientHash'
import { sendMagicLink } from '@/lib/auth/mail'
import { verifyUrl } from '@/lib/auth/links'
import { createAdminClient, createRouteClient } from '@/lib/supabase/server'
import { LAST_UPDATED } from '@/lib/legal/documents'

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

  // email_confirm is what lets the session start now, which is what lets the
  // held sentence post now (§3.9). It is NOT the verification signal — nobody
  // has proven they can read this address yet. That claim belongs to
  // profiles.verified_at, which only /auth/callback ever sets.
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
    /*
     * The acceptance is recorded here and nowhere else.
     *
     * This is the server-side half of the sentence the prompt says before it
     * asks for an address: making an account means agreeing to the terms. It
     * is written under the service role, on the same statement that creates
     * the account, so the record and the thing it is a record of cannot come
     * apart — and there is no UPDATE grant on profiles for anybody, so it
     * cannot be forged from a browser afterwards.
     *
     * The version matters more than the timestamp. "They agreed" is nearly
     * useless once the document has changed; "they agreed to this version of
     * it" is the part that can be stood behind.
     */
    .insert({
      id: created.user.id,
      name: validated.name,
      terms_accepted_at: new Date().toISOString(),
      terms_version: LAST_UPDATED,
    })

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

  /*
   * The session first, and the emailed key second. That order is the whole
   * bug fix, and it is not cosmetic.
   *
   * GoTrue keeps ONE token per user per type — a single column on auth.users —
   * so minting a second magiclink for the same person *overwrites* the first.
   * This used to mint the key, email it, and then mint a second one to consume
   * for the session, which invalidated the key in the same breath: the link in
   * the inbox was dead before the message was sent. Everybody who ever clicked
   * one got "already been used, or it expired", including on a brand new
   * account, and the comment sitting here claimed the two were independent.
   *
   * Minting after the first is spent is safe: consuming a token does not stop
   * a later one being issued, and a session is a refresh token rather than
   * anything in those columns, so issuing the key cannot log them back out.
   */
  const { data: sessionLink, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: body.email,
  })

  if (linkError || !sessionLink?.properties?.hashed_token) {
    return NextResponse.json({ error: 'could not sign you in' }, { status: 500 })
  }

  // Consuming a link server-side is what puts the session in the cookie, so the
  // held sentence can post right now rather than after a trip to an inbox.
  //
  // `magiclink`, matching how it was minted. It said `email` before, which is a
  // different token type and fails in a way that reads as an expired link.
  const supabase = await createRouteClient()
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: sessionLink.properties.hashed_token,
  })

  if (verifyError) {
    return NextResponse.json({ error: 'could not sign you in' }, { status: 500 })
  }

  // Now, and only now, the key that goes in the inbox — the current token for
  // this account, and the one that will still be current when they click it.
  //
  // §4.7, as revised: this is what turns a name into an account somebody can
  // come back to. Until it is followed they get one contribution — the held
  // sentence — and then they are asked.
  const { data: keyLink } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: body.email,
  })

  // Built from `hashed_token` rather than sent as `action_link`: see
  // lib/auth/links.ts. The action link bounces through Supabase and comes back
  // with the session in a URL fragment, which a server can never read.
  const delivery = keyLink?.properties?.hashed_token
    ? await sendMagicLink(body.email, verifyUrl(keyLink.properties.hashed_token))
    : { sent: false, note: 'couldn’t make you a key just now. type resend to try again.' }

  return NextResponse.json({ name: validated.name, note: delivery.note })
}
