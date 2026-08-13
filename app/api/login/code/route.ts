import { NextResponse } from 'next/server'
import { validateName } from '@/lib/auth/names'
import { clientHash } from '@/lib/auth/clientHash'
import { createAdminClient, createRouteClient } from '@/lib/supabase/server'

/**
 * Signing in with the code from the email, rather than the link.
 *
 * Reported by hand, and it is not a Gmail bug: a mail app opens links in a
 * browser it owns, which has its own cookie storage. Tapping the key therefore
 * signs you in *inside the mail app*, spends the single-use token doing it, and
 * leaves the browser you were actually reading in a stranger. Opening the same
 * link in Safari afterwards lands on "that key had already been used", which is
 * true and reads as nothing having happened.
 *
 * No wording fixes that. A cookie set in one browser is not readable in
 * another, and by the time anybody chooses a browser the token is gone.
 *
 * The code has no browser in it. It is read with the eyes and typed into the
 * prompt that is already open, so the session lands where the person is. This
 * route is where that typing arrives — and it is the *only* thing here that
 * writes a session cookie besides `/auth/callback` and signup.
 */

/**
 * How wrong the code may be before this stops answering.
 *
 * The number that matters, and the reason this route is not simply
 * `/auth/callback` with a shorter token. A link's token is long enough that
 * guessing is not a strategy. GoTrue's `email_otp` is six digits — a million
 * possibilities, which a script exhausts in minutes if nothing counts the
 * misses.
 *
 * Counted two ways, because they stop different attacks: per caller, which
 * bounds one machine, and **per account**, which is the one that matters, since
 * an attacker who rotates addresses defeats the first and not the second. Names
 * are public here, so picking a target is free.
 *
 * Ten an hour against any one account. Somebody fat-fingering six characters on
 * a phone has room to be wrong several times; a guesser gets 1 in 100,000 per
 * hour, and the code expires long before then anyway.
 */
const PER_ACCOUNT = 10
const PER_CALLER = 20

/**
 * What GoTrue mints, plus room for it to change.
 *
 * `email_otp` is six digits today. Pinning `\d{6}` here would turn a provider
 * default into a hard requirement of this route — and the failure would be
 * every login refused as "that doesn't look like a code" while the code in the
 * email was perfectly good.
 */
const CODE = /^[a-z0-9]{4,12}$/

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { name?: string; code?: string }
    | null

  const validated = validateName(body?.name ?? '')
  if (!validated.ok) {
    return NextResponse.json({ error: validated.reason }, { status: 400 })
  }

  // Spaces and dashes come out, because they go in: a code read off a screen
  // gets typed as `483 920` about as often as `483920`, and refusing that would
  // be refusing somebody who did everything right.
  const code = (body?.code ?? '').toLowerCase().replace(/[\s-]/g, '')
  if (!CODE.test(code)) {
    return NextResponse.json(
      { error: 'that doesn’t look like the code. it’s the short one in the email.' },
      { status: 400 },
    )
  }

  const admin = createAdminClient()

  const { data: callerOk, error: callerError } = await admin.rpc('record_attempt', {
    p_kind: 'login-code',
    p_client_hash: clientHash(request),
    p_limit: PER_CALLER,
  })

  if (callerError) {
    return NextResponse.json({ error: 'couldn’t check that just now.' }, { status: 500 })
  }
  if (callerOk === false) {
    return NextResponse.json(
      { error: 'too many tries. wait an hour, or ask for a new key with login and your name.' },
      { status: 429 },
    )
  }

  const { data: profile, error: lookupError } = await admin
    .from('profiles')
    .select('id, name, banned_at')
    .ilike('name', validated.name)
    .maybeSingle()

  if (lookupError) {
    return NextResponse.json({ error: 'couldn’t look that up just now.' }, { status: 500 })
  }

  /*
   * One sentence for "no such account", "that account is closed" and "wrong
   * code", and it is deliberate.
   *
   * `/api/login` can afford to say "no one here is called ren", because a name
   * is public and the answer leaks nothing reading the site would not. This
   * cannot: an attacker with a name and a wrong code learns from a *different*
   * refusal that the name is real and the code is the only thing missing, which
   * is the difference between a lock and a lock with the keyhole labelled.
   */
  const refuse = () =>
    NextResponse.json(
      { error: 'that code didn’t work. it may have expired — login and your name sends another.' },
      { status: 401 },
    )

  if (!profile || profile.banned_at) return refuse()

  const { data: targetOk, error: targetError } = await admin.rpc('record_attempt', {
    p_kind: 'login-code-to',
    // The account, not the caller — the limit an address-rotating guesser
    // cannot get around.
    p_client_hash: profile.id,
    p_limit: PER_ACCOUNT,
  })

  if (targetError) {
    return NextResponse.json({ error: 'couldn’t check that just now.' }, { status: 500 })
  }
  if (targetOk === false) {
    return NextResponse.json(
      { error: 'too many tries. wait an hour, or ask for a new key with login and your name.' },
      { status: 429 },
    )
  }

  const { data: account, error: accountError } = await admin.auth.admin.getUserById(profile.id)
  if (accountError || !account?.user?.email) return refuse()

  /*
   * The route client, not the admin one. This is the whole reason the flow
   * works: `createRouteClient` writes the session cookie into the response, so
   * the browser that typed the code is the browser that ends up signed in.
   *
   * `type` matches how the key was minted in `/api/login` — `generateLink` was
   * asked for a `magiclink`, and `email_otp` is that same key in short form.
   * A mismatch here fails quietly and looks exactly like a wrong code, which is
   * the bug that made every emailed link decorative for a fortnight.
   */
  const supabase = await createRouteClient()
  const { data, error } = await supabase.auth.verifyOtp({
    email: account.user.email,
    token: code,
    type: 'magiclink',
  })

  if (error || !data.user) {
    console.error(`a code did not verify — ${error?.message ?? 'no user returned'}`)
    return refuse()
  }

  /*
   * They can read the inbox. Same claim `/auth/callback` makes and for the same
   * reason (§4.7) — the code arrived in that address and nowhere else.
   *
   * Not swallowed on failure. `/auth/callback` used to log this and carry on,
   * which left people in a loop: follow the key, come back, still be told to
   * follow the key. It is also the exact shape of an unapplied migration.
   */
  //
  // Under the service role and naming the user, for the reason spelled out in
  // `/auth/callback`: the session-callable version was the §4.7 gate handing
  // itself out to anyone with a session, which is everyone.
  const { error: markError } = await admin.rpc('mark_verified', { p_user: data.user.id })
  if (markError) {
    console.error(
      `could not mark verified — ${markError.code ?? 'no code'}: ${markError.message}` +
        (markError.code === 'PGRST202'
          ? '\n  mark_verified(p_user uuid) does not exist on this project. Apply the migrations: ./scripts/db-deploy.sh'
          : ''),
    )
    return NextResponse.json(
      { error: 'signed you in, but couldn’t finish marking you verified. try login again.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ name: profile.name })
}
