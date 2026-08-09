import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'

/**
 * Signing in with the code instead of the link.
 *
 * Reported by hand, and the report contained the whole diagnosis: "when i click
 * the link in my gmail and then select safari its still opening it in the gmail
 * app". It was not a browser-picker problem. A mail app opens links in a
 * browser it owns, with its own cookie storage — so the key gets spent *there*,
 * signing you into a browser you will never use again, and Safari afterwards
 * finds a used key and no session.
 *
 * Nothing about that is fixable with wording. A cookie set in one browser is
 * not readable in another, and by the time anybody picks a browser the
 * single-use token is gone.
 *
 * The code has no browser in it: read with the eyes, typed into the prompt that
 * is already open, verified by a route that writes the cookie into *that*
 * browser's response. These tests are about the exchange — the question, the
 * retry, the ways out — and about the one property the whole thing exists for,
 * which is that answering it changes who this browser is.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')
const LOBBY: Location = {}
const RIGHT = '483920'

function harness(options: { me?: string; codeSent?: boolean } = {}) {
  const accounts = new Set(['ryan', 'marisol'])
  const sent: string[] = []
  const tried: { name: string; code: string }[] = []

  const api: SignupApi = {
    async checkName(name) {
      return { available: !accounts.has(name), alternates: [] }
    },
    async create(name) {
      return { ok: true as const, name }
    },
    async logout() {
      return { ok: true as const }
    },
    async login(name) {
      if (!accounts.has(name)) {
        return { ok: false as const, reason: `no one here is called ${name}.` }
      }
      sent.push(name)
      return {
        ok: true as const,
        name,
        note: `sent a key to the address ${name} signed up with.`,
        codeSent: options.codeSent ?? true,
      }
    },
    async loginCode(name, code) {
      tried.push({ name, code })
      if (code.replace(/[\s-]/g, '') !== RIGHT) {
        return {
          ok: false as const,
          reason: 'that code didn’t work. it may have expired — login and your name sends another.',
        }
      }
      return { ok: true as const, name }
    },
    async resend() {
      return { note: 'another key is on its way.' }
    },
  }

  const writer: Writer = {
    async post() {
      return 42
    },
    async reply() {
      return 1
    },
    async rename(name) {
      return { ok: true as const, name }
    },
  }

  const session = new Session(api, writer, options.me)
  return { session, run: createRunner(fixtureEnv(), ['commons'], session), sent, tried }
}

describe('login asks for the code', () => {
  it('asks, straight after sending', async () => {
    const { run } = harness()
    const out = text((await run('login ryan', LOBBY)).lines)

    expect(out).toContain('sent a key')
    expect(out).toContain('code')
  })

  it('says why a code and not the link, since that is the confusing part', async () => {
    // Somebody who has already tapped the link needs to know why they are being
    // asked for something else, or the question reads as the site not noticing.
    const { run } = harness()
    const out = text((await run('login ryan', LOBBY)).lines)
    expect(out).toContain('this browser')
  })

  it('takes what is typed next as the code, not as a command', async () => {
    const { session, run } = harness()
    await run('login ryan', LOBBY)
    expect(session.isAsking()).toBe(true)

    // `look` is a real verb. While the question is open it is an answer, and a
    // wrong one — which is the whole reason this is a mode and not a prompt.
    const out = text((await run('look', LOBBY)).lines)
    expect(out).toContain('didn’t work')
  })

  it('does not ask when this deployment sent no code', async () => {
    /*
     * A build with no mail provider mints no `email_otp`, so there is nothing to
     * type. Asking anyway would be a dead end of its own: a question whose only
     * answer never arrives, in place of a link that at least works.
     */
    const { session, run } = harness({ codeSent: false })
    const out = text((await run('login ryan', LOBBY)).lines)

    expect(session.isAsking()).toBe(false)
    expect(out).not.toContain('code')
  })
})

describe('the right code signs this browser in', () => {
  it('changes who the session is', async () => {
    const { session, run } = harness()
    await run('login ryan', LOBBY)
    expect(session.name()).toBe(null)

    await run(RIGHT, LOBBY)
    expect(session.name()).toBe('ryan')
  })

  it('reports the change, so the prompt label follows', async () => {
    /*
     * The one field that carries this. `answer()`'s ask-one branch used to copy
     * `lines` and `location` across by hand and drop everything else — which was
     * harmless while no answered question could sign anybody in, and would have
     * left this one printing "you're ryan again" above a prompt still reading
     * `guest`.
     */
    const { run } = harness()
    await run('login ryan', LOBBY)
    const result = await run(RIGHT, LOBBY)

    expect(result.identity).toBe('ryan')
    expect(text(result.lines)).toContain('ryan')
  })

  it('leaves the question behind once it is answered', async () => {
    const { session, run } = harness()
    await run('login ryan', LOBBY)
    await run(RIGHT, LOBBY)
    expect(session.isAsking()).toBe(false)
  })

  it('switches accounts when it is somebody else’s code', async () => {
    const { session, run } = harness({ me: 'ryan' })
    const asked = text((await run('login marisol', LOBBY)).lines)
    // Warned before it happens, because being switched is a surprise.
    expect(asked).toContain('you’re ryan until')

    const result = await run(RIGHT, LOBBY)
    expect(session.name()).toBe('marisol')
    expect(result.identity).toBe('marisol')
  })
})

describe('a wrong code comes back to the same question', () => {
  it('asks again rather than dropping to the prompt', async () => {
    // Six characters mistyped by one on a phone is the common case, and the
    // expensive recovery — run login again, wait for another email — is the one
    // thing this design was supposed to remove.
    const { session, run } = harness()
    await run('login ryan', LOBBY)

    const out = text((await run('483921', LOBBY)).lines)
    expect(out).toContain('didn’t work')
    expect(session.isAsking()).toBe(true)

    await run(RIGHT, LOBBY)
    expect(session.name()).toBe('ryan')
  })

  it('says what to do when it has expired, and that is a thing the site accepts', async () => {
    const { run } = harness()
    await run('login ryan', LOBBY)
    const out = text((await run('000000', LOBBY)).lines)

    // CHANGING-IT's rule: a suggested fix has to be one the site will take.
    expect(out).toContain('login and your name')
  })

  it('re-asks the real question when nothing is typed', async () => {
    /*
     * The empty branch used to substitute "still waiting — say it in a few
     * words", written for the room-gloss question, which is the only other
     * caller. Told to somebody asked for a code it is advice for a different
     * question.
     */
    const { run } = harness()
    await run('login ryan', LOBBY)
    const out = text((await run('   ', LOBBY)).lines)

    expect(out).toContain('still waiting')
    expect(out).toContain('code')
    expect(out).not.toContain('a few words')
  })
})

describe('the ways out of the question', () => {
  it('cancel gets out', async () => {
    const { session, run } = harness()
    await run('login ryan', LOBBY)
    await run('cancel', LOBBY)

    expect(session.isAsking()).toBe(false)
    expect(session.name()).toBe(null)
  })

  it('cancel does not claim nothing was sent, because a key was', async () => {
    /*
     * "No problem — nothing sent" is about the held sentence, and it was true of
     * every branch until a question could follow something that really was
     * sent. Cancelling here leaves a live key in a real inbox; telling that
     * person nothing was sent is a small lie at the exact moment they are
     * already confused about what happened to their email.
     */
    const { run } = harness()
    await run('login ryan', LOBBY)
    const out = text((await run('cancel', LOBBY)).lines)

    expect(out).toContain('no problem')
    expect(out).not.toContain('nothing sent')
  })

  it('login again mid-question sends a new key and asks again', async () => {
    const { session, run, sent } = harness()
    await run('login ryan', LOBBY)
    await run('login marisol', LOBBY)

    expect(sent).toEqual(['ryan', 'marisol'])
    expect(session.isAsking()).toBe(true)

    // And it is marisol's code that is now wanted, not ryan's.
    await run(RIGHT, LOBBY)
    expect(session.name()).toBe('marisol')
  })
})

describe('what the code is checked against, before it is checked', () => {
  const route = readFileSync(
    join(__dirname, '..', '..', 'app', 'api', 'login', 'code', 'route.ts'),
    'utf8',
  )
  // Comments first — this repo's guards have been tripped four times by prose
  // sitting next to the thing they match, and every one of them explains a bug
  // by quoting it.
  const source = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  it('counts wrong guesses against the account, not only the caller', async () => {
    /*
     * The number that makes this safe. A link's token is long enough that
     * guessing is not a strategy; six digits is a million, which a script
     * exhausts in minutes. A per-caller limit alone is defeated by rotating
     * addresses, and names here are public, so choosing a target is free.
     */
    expect(source).toContain('login-code-to')
    expect(source).toContain('p_client_hash: profile.id')
  })

  it('counts them against the caller too', () => {
    expect(source).toContain("p_kind: 'login-code'")
    expect(source).toContain('clientHash(request)')
  })

  it('answers a wrong code and a missing account with the same sentence', () => {
    /*
     * `/api/login` can afford "no one here is called ren" — a name is public.
     * This cannot: a different refusal for a real name with a wrong code tells
     * a guesser the name is right and only the code is missing, which is a lock
     * with the keyhole labelled.
     */
    const refusals = source.match(/that code didn’t work/g) ?? []
    expect(refusals.length).toBe(1)
    expect(source).toContain('if (!profile || profile.banned_at) return refuse()')
  })

  it('writes the session through the cookie-writing client, not the admin one', () => {
    // The entire point: the browser that typed the code is the browser that
    // ends up signed in. `createAdminClient` would verify and set nothing.
    expect(source).toContain('createRouteClient()')
    expect(source).toMatch(/supabase\.auth\.verifyOtp/)
  })

  it('does not pin the code to six digits', () => {
    // `email_otp` is six digits today. Pinning it here would turn a provider
    // default into a hard rule of this route, and the failure mode is every
    // login refused while the code in the email is perfectly good.
    expect(source).not.toMatch(/\\d\{6\}/)
  })
})
