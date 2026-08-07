import { NextResponse } from 'next/server'
import { validateName } from '@/lib/auth/names'
import { clientHash } from '@/lib/auth/clientHash'
import { sendMagicLink } from '@/lib/auth/mail'
import { verifyUrl } from '@/lib/auth/links'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * The way back in, which did not exist.
 *
 * §3.9's deferred signup covers arriving: say something, be asked who you are,
 * get a key. It quietly assumed the cookie would still be there next time. It
 * is not — new phone, cleared browser, a session that aged out — and there was
 * no second door:
 *
 *   * `resend` reads the address off `auth.getUser()`, so with no session it
 *     cannot know where to send anything. It answers "this browser isn't
 *     signed in" and tells you to say something.
 *   * Saying something asks for a name, and answering with **your own** name
 *     hits the taken check and offers you `ryan2`. The one correct answer was
 *     the one refused.
 *
 * So somebody who already had an account was told, in two steps, to make a
 * second one. This is that door: name in, key to the address that name signed
 * up with.
 *
 * Taking a name rather than an address is deliberate. Names here are public —
 * they head every post and `go ~name` is a documented command — so answering
 * "no one is called that" leaks nothing that reading the site does not. An
 * address is the part that is private, and it is never asked for, never
 * echoed, and never confirmed.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { name?: string } | null
  const validated = validateName(body?.name ?? '')
  if (!validated.ok) {
    return NextResponse.json({ error: validated.reason }, { status: 400 })
  }

  const admin = createAdminClient()

  /*
   * Two limits, because they stop two different things.
   *
   * Per caller: this mints and sends real mail on an unauthenticated route, so
   * without a cap it is a loop that burns the sending quota — the same exposure
   * §7 calls "unbounded, unpaid".
   *
   * Per account: the caller limit alone still lets somebody rotating addresses
   * fill one person's inbox with keys they did not ask for. Five an hour for a
   * caller who may be mistyping their own name; three an hour aimed at any one
   * account, which is plenty for "it didn't arrive" and useless as a weapon.
   */
  const { data: callerOk, error: callerError } = await admin.rpc('record_attempt', {
    p_kind: 'login',
    p_client_hash: clientHash(request),
    p_limit: 5,
  })

  if (callerError) {
    return NextResponse.json({ error: 'couldn’t send just now.' }, { status: 500 })
  }
  if (callerOk === false) {
    return NextResponse.json(
      { error: 'that’s a lot of keys. try again in an hour — check spam meanwhile.' },
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

  if (!profile) {
    // §3.7 — an error that says what to do instead. "No account" and "you have
    // never made one" are the same sentence to the person reading it, and the
    // way out of both is the same.
    return NextResponse.json(
      {
        error: `no one here is called ${validated.name}. if you’ve not been here before, say something and i’ll set you up.`,
      },
      { status: 404 },
    )
  }

  if (profile.banned_at) {
    // Not "wrong name". Somebody who was removed is owed the truth about it,
    // and a key that signs them into an account which refuses every write is
    // worse than a plain answer.
    return NextResponse.json(
      { error: 'that account was closed. hello@thewall.social if that’s wrong.' },
      { status: 403 },
    )
  }

  const { data: targetOk, error: targetError } = await admin.rpc('record_attempt', {
    p_kind: 'login-to',
    // The account, not the caller. Same counter, different key — which is why
    // the kind differs too, so the two never share a bucket.
    p_client_hash: profile.id,
    p_limit: 3,
  })

  if (targetError) {
    return NextResponse.json({ error: 'couldn’t send just now.' }, { status: 500 })
  }
  if (targetOk === false) {
    // Deliberately the same sentence the caller limit gives. Otherwise the
    // difference between the two tells an attacker they have found a real
    // account and how often somebody has asked for its key.
    return NextResponse.json(
      { error: 'that’s a lot of keys. try again in an hour — check spam meanwhile.' },
      { status: 429 },
    )
  }

  const { data: account, error: accountError } = await admin.auth.admin.getUserById(profile.id)
  if (accountError || !account?.user?.email) {
    return NextResponse.json({ error: 'couldn’t send to that account.' }, { status: 500 })
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: account.user.email,
  })

  if (linkError || !link?.properties?.hashed_token) {
    return NextResponse.json({ error: 'couldn’t make a key just now.' }, { status: 500 })
  }

  /*
   * The same key, twice: a URL and the six characters GoTrue minted beside it.
   *
   * `generateLink` has always returned `email_otp` and this route has always
   * thrown it away. Sending it is what makes signing in work from a mail app —
   * the link opens in whatever browser the mail app owns, sets the cookie
   * there, and spends itself doing it, so the browser the person is actually
   * reading in never sees a session. A code has no browser in it.
   *
   * Built from `hashed_token`, never `action_link` — see lib/auth/links.ts.
   */
  const code = link.properties.email_otp ?? null

  const delivery = await sendMagicLink(
    account.user.email,
    verifyUrl(link.properties.hashed_token, 'magiclink', request),
    code,
  )

  if (!delivery.sent) {
    return NextResponse.json({ error: delivery.note }, { status: 502 })
  }

  /*
   * The name comes back, the address does not — not even masked. `r***@gmail`
   * is enough to confirm a guess about somebody, and there is nothing the
   * person actually signing in needs it for: they know which inbox is theirs.
   */
  return NextResponse.json({
    name: profile.name,
    /*
     * Reported by hand: the link opened in Gmail's own browser, and choosing
     * "open in Safari" did not help — by then the key was spent, and the
     * session it set was in a cookie jar Safari cannot read.
     *
     * So the instruction leads with the code. `codeSent` tells the prompt to
     * ask for it; without it the prompt has no way to know whether this
     * deployment has mail configured at all, and asking for a code that was
     * never sent would be a dead end of its own.
     */
    codeSent: code !== null,
    note: code
      ? `sent a key to the address ${profile.name} signed up with.`
      : `sent a key to the address ${profile.name} signed up with. follow it and you’re back.`,
  })
}
