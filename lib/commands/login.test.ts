import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRunner } from '@/lib/commands/run'
import { suggestAlternates } from '@/lib/auth/names'
import { fixtureEnv } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'

/**
 * Getting back in.
 *
 * §3.9 designed arriving and assumed the cookie would still be there next time.
 * On a new phone it is not, and until now there was no second door — the two
 * things a returning person would try both walked them into making a *second*
 * account under a second name, losing the first one's history for good:
 *
 *   resend  → "this browser isn't signed in" → say something
 *   say     → "what should I call you?" → ryan → "ryan is taken. ryan2 is free."
 *
 * These tests are mostly about that loop being shut, because the loop is the
 * bug. `login` existing is the easy half.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')
const LOBBY: Location = {}

function harness(options: { me?: string; accounts?: string[] } = {}) {
  const accounts = new Set(options.accounts ?? ['ryan', 'marisol'])
  const asked: string[] = []

  const api: SignupApi = {
    async checkName(name) {
      const available = !accounts.has(name)
      return { available, alternates: available ? [] : suggestAlternates(name, accounts) }
    },
    async create(name) {
      return { ok: true as const, name }
    },
    async login(name) {
      asked.push(name)
      if (!accounts.has(name)) {
        return {
          ok: false as const,
          reason: `no one here is called ${name}. if you’ve not been here before, say something and i’ll set you up.`,
        }
      }
      return {
        ok: true as const,
        name,
        note: `sent a key to the address ${name} signed up with. click it and you’re back.`,
      }
    },
    async resend() {
      return { note: 'another key is on its way.' }
    },
  }

  const writer: Writer = {
    async post() {
      return 42
    },
    async reply() {},
    async rename(name) {
      return { ok: true as const, name }
    },
  }

  const session = new Session(api, writer, options.me)
  return { session, run: createRunner(fixtureEnv(), ['commons'], session), asked }
}

describe('login — the way back in', () => {
  it('sends a key for a name that exists', async () => {
    const { run, asked } = harness()
    const out = text((await run('login ryan', LOBBY)).lines)

    expect(asked).toEqual(['ryan'])
    expect(out).toContain('sent a key')
    expect(out).toContain('ryan')
  })

  it('never says which address it went to', async () => {
    /*
     * The name is public — it heads every post — and the address is the part
     * that is not. Even a masked `r***@gmail.com` confirms a guess about
     * somebody, and the person actually signing in already knows which inbox is
     * theirs, so there is nothing to trade for the leak.
     */
    const { run } = harness()
    const out = text((await run('login ryan', LOBBY)).lines)
    expect(out).not.toMatch(/@/)
  })

  it('says nobody is called that, and what to do instead', async () => {
    const { run } = harness()
    const out = text((await run('login nobody', LOBBY)).lines)

    expect(out).toContain('no one here is called nobody')
    // §3.7 — an error with a way out. "No account" and "you have never made
    // one" read the same to the person in front of it.
    expect(out).toContain('say something')
  })

  it('asks for the name when given none', async () => {
    const { session, run } = harness()
    const out = text((await run('login', LOBBY)).lines)

    expect(out).toMatch(/what name/i)
    expect(session.isAsking()).toBe(true)
  })

  it('takes the answer to that question as the name, not as a command', async () => {
    const { session, run, asked } = harness()
    await run('login', LOBBY)
    const out = text((await session.answer('marisol')).lines)

    expect(asked).toEqual(['marisol'])
    expect(out).toContain('sent a key')
    expect(session.isAsking()).toBe(false)
  })

  it('answers "who am i" rather than asking, when there is already a session', async () => {
    // Bare `login` while signed in is far more likely to be a question than the
    // start of a switch, and asking "what name?" of somebody who has one is the
    // interface not listening.
    const { run, asked } = harness({ me: 'ryan' })
    const out = text((await run('login', LOBBY)).lines)

    expect(out).toContain('you’re signed in as ryan')
    expect(asked).toEqual([])
  })

  it('does not send a key to somebody already signed in as that name', async () => {
    const { run, asked } = harness({ me: 'ryan' })
    const out = text((await run('login ryan', LOBBY)).lines)

    expect(asked).toEqual([])
    expect(out).toContain('already signed in')
  })

  it('warns that following the link switches accounts', async () => {
    const { run } = harness({ me: 'ryan' })
    const out = text((await run('login marisol', LOBBY)).lines)

    expect(out).toContain('sent a key')
    expect(out).toContain('until you follow it')
  })

  it('changes nothing about the session on its own', async () => {
    /*
     * A key in an inbox is a claim nobody has proved yet. `/auth/callback` is
     * the only thing that has ever made somebody signed in, and asking for a
     * link must not be a way around it.
     */
    const { session, run } = harness()
    await run('login ryan', LOBBY)
    expect(session.name()).toBe(null)
  })

  it('is reachable from help, which is the whole reason it is not hidden', async () => {
    // `resend` can be hidden because the message that needs it names it.
    // Nothing names this one: somebody on a new phone has no session, so no
    // message has fired, and they are looking at what a stranger sees.
    for (const location of [LOBBY, { room: 'music' } as Location]) {
      const out = text((await harness().run('help', location)).lines)
      expect(out).toContain('login — ')
    }
  })
})

describe('the loop that sent people to a second account', () => {
  it('offers login when the name you gave at signup is your own', async () => {
    const { session } = harness()
    session.begin({ location: { room: 'commons' }, body: 'hello' })
    const out = text((await session.answer('ryan')).lines)

    expect(out).toContain('ryan is taken.')
    expect(out).toContain('login ryan')
  })

  it('puts that before the alternates, because for that reader they are not options', async () => {
    const { session } = harness()
    session.begin({ location: { room: 'commons' }, body: 'hello' })
    const lines = (await session.answer('ryan')).lines
    const offer = lines.findIndex((line) => line.text.includes('login ryan'))
    const alternates = lines.findIndex((line) => line.text.includes('are free'))

    expect(offer).toBeGreaterThanOrEqual(0)
    expect(alternates).toBeGreaterThan(offer)
  })

  it('still offers the alternates, for the stranger who wanted that name', async () => {
    const { session } = harness()
    session.begin({ location: { room: 'commons' }, body: 'hello' })
    expect(text((await session.answer('ryan')).lines)).toContain('are free')
  })

  it('no longer tells a signed-out browser to go and sign up again', () => {
    /*
     * The resend route's 401 is the other half of the loop and there is no
     * runtime path to it from here — it needs a real Supabase session to be
     * absent, which the fixtures cannot arrange. So it is read from source.
     *
     * What it used to say was "say something, and if the name is already yours
     * use the same one", which could not work: that is precisely the answer the
     * taken check refuses.
     */
    const source = readFileSync(
      join(__dirname, '..', '..', 'app', 'api', 'verify', 'resend', 'route.ts'),
      'utf8',
    )
    // Comments explain the old wording, so they have to go before matching.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

    expect(code).toContain('login <yourname>')
    expect(code).not.toMatch(/if the name is already yours/)
  })
})

/**
 * The route sends real mail on an unauthenticated request, and neither the unit
 * suite nor the e2e suite can reach it — both run against fixtures, and the
 * database suite calls SQL rather than routes. So the properties that make it
 * safe to expose are read out of the source, which is the same choice made for
 * the PostgREST embeds and the callback redirect.
 */
/**
 * Everything passed to `NextResponse.json(...)`, by counting brackets.
 *
 * A regex was tried first and found one of the six calls, which would have made
 * the assertion below almost entirely vacuous — the kind of guard that reports
 * a file is clean because it barely read it. Hence the meta-assertion on the
 * count beside it.
 */
function responseBodies(code: string): string[] {
  const bodies: string[] = []
  const marker = 'NextResponse.json('

  for (let at = code.indexOf(marker); at !== -1; at = code.indexOf(marker, at + 1)) {
    let depth = 0
    const from = at + marker.length
    for (let i = from; i < code.length; i += 1) {
      if (code[i] === '(') depth += 1
      else if (code[i] === ')') {
        if (depth === 0) {
          bodies.push(code.slice(from, i))
          break
        }
        depth -= 1
      }
    }
  }
  return bodies
}

describe('what makes an unauthenticated mail route safe to expose', () => {
  const code = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'login', 'route.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  it('is scanning the file it thinks it is', () => {
    // Without this the three assertions below pass just as happily against an
    // empty string, which is what a moved or renamed route would hand them.
    expect(code).toContain('generateLink')
    expect(code).toContain('sendMagicLink')
  })

  it('limits the caller and the account separately', () => {
    /*
     * Two different attacks. Per caller stops the loop that burns the sending
     * quota; per account stops somebody rotating addresses to fill one person's
     * inbox with keys they never asked for. Either alone leaves the other open.
     */
    expect(code).toContain("p_kind: 'login'")
    expect(code).toContain("p_kind: 'login-to'")
    expect(code).toContain('p_client_hash: profile.id')
  })

  it('gives the same answer to both limits, so neither confirms an account', () => {
    const refusals = [...code.matchAll(/that’s a lot of keys[^']*/g)].map((m) => m[0])
    expect(refusals.length).toBe(2)
    expect(refusals[0]).toBe(refusals[1])
  })

  it('never puts the address in the response', () => {
    // Not even masked. `r***@gmail.com` is enough to confirm a guess, and the
    // person signing in already knows which inbox is theirs.
    const responses = responseBodies(code)
    expect(responses.length).toBeGreaterThan(3)
    for (const body of responses) {
      expect(body).not.toContain('email')
      expect(body).not.toContain('user.email')
    }
  })

  it('refuses an account that was closed rather than mailing it a key', () => {
    expect(code).toContain('banned_at')
    expect(code).toContain('that account was closed')
  })
})
