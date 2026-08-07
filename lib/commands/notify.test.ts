import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv, type Env } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import { digestSubject, digestText, unsubscribeUrl } from '@/lib/auth/digest'
import type { Line, Location } from '@/lib/shell/types'

/**
 * §4.1, decided differently — and the difference is consent.
 *
 * The document's lean is "pull-only, no push, no email", in the same section
 * that calls notifications its highest-priority unsolved item because "no
 * notification means no reason to return". Both are true. What holds them
 * together is that nobody is emailed who did not ask for it, which makes
 * "off until you type something" the load-bearing part rather than a setting.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')
const LOBBY: Location = {}

function harness(options: { me?: string | null; refuse?: string } = {}) {
  const calls: boolean[] = []
  let on = false

  const base = fixtureEnv()
  const env: Env = {
    ...base,
    async notifyState() {
      return on
    },
    async setNotify(next: boolean) {
      calls.push(next)
      if (options.refuse) return { ok: false as const, reason: options.refuse }
      on = next
      return { ok: true as const, on: next }
    },
  }

  const api: SignupApi = {
    async checkName() {
      return { available: true, alternates: [] }
    },
    async create(name) {
      return { ok: true as const, name }
    },
    async logout() {
      return { ok: true as const }
    },
    async login(name) {
      return { ok: true as const, name, note: 'sent' }
    },
    async loginCode(name: string) {
      return { ok: true as const, name }
    },
    async resend() {
      return { note: '' }
    },
  }
  const writer: Writer = {
    async post() {
      return 1
    },
    async reply() {},
    async rename(name) {
      return { ok: true as const, name }
    },
  }

  const session = new Session(api, writer, options.me === null ? undefined : (options.me ?? 'ryan'))
  return { run: createRunner(env, ['commons'], session), calls, state: () => on }
}

describe('notify — off until you ask', () => {
  it('is off, and says what turning it on would mean', async () => {
    const { run, calls } = harness()
    const out = text((await run('notify', LOBBY)).lines)

    expect(out).toContain('off')
    expect(out).toContain('notify on')
    // Asking is not a toggle. Somebody typing `notify` to find out where they
    // stand should not have changed where they stand.
    expect(calls).toEqual([])
  })

  it('turns on, and says what it will and will not do', async () => {
    const { run, state } = harness()
    const out = text((await run('notify on', LOBBY)).lines)

    expect(state()).toBe(true)
    expect(out).toContain('one email a day')
    // The bound that makes it survivable: a day nobody answered you is a day
    // with no email, not a daily reminder that nothing happened.
    expect(out).toMatch(/only when somebody has answered you/)
  })

  it('names the way out in the same breath as the way in', async () => {
    const out = text((await harness().run('notify on', LOBBY)).lines)
    expect(out).toContain('notify off')
    expect(out).toMatch(/link that turns this off/)
  })

  it('turns off again', async () => {
    const { run, state } = harness()
    await run('notify on', LOBBY)
    const out = text((await run('notify off', LOBBY)).lines)

    expect(state()).toBe(false)
    expect(out).toContain('nothing more will be sent')
  })

  it('reports the state it is actually in', async () => {
    const { run } = harness()
    await run('notify on', LOBBY)
    expect(text((await run('notify', LOBBY)).lines)).toContain('on —')
  })

  it('refuses a word it does not know, rather than guessing', async () => {
    // Guessing here means guessing about email, in the direction of sending it.
    const { run, calls } = harness()
    const out = text((await run('notify maybe', LOBBY)).lines)

    expect(out).toMatch(/notify on, or notify off/)
    expect(calls).toEqual([])
  })

  it('passes the database refusal through rather than restating it', async () => {
    // The one that matters: turning it on before following your key. The
    // function raises a sentence already written for a person to read.
    const { run } = harness({ refuse: 'follow the link in your email first — then i can send you things.' })
    const out = text((await run('notify on', LOBBY)).lines)
    expect(out).toContain('follow the link in your email first')
  })

  it('tells a guest there is nowhere to send anything', async () => {
    // And does not reach the database to find that out: a reader with no name
    // has no address, which is knowable without asking.
    const { run, calls } = harness({ me: null })
    const out = text((await run('notify on', LOBBY)).lines)

    expect(out).toMatch(/reading as a guest/)
    expect(calls).toEqual([])
  })

  it('is in help, because a setting nobody can find is not one', async () => {
    expect(text((await harness().run('help', LOBBY)).lines)).toContain('notify — ')
  })
})

describe('what the email itself says', () => {
  const digest = { name: 'ryan', email: 'ryan@example.com', unread: 3, token: 'tok-123' }
  const body = digestText(digest, 'https://thewall.social')

  it('says how many, and where to go', () => {
    expect(digestSubject(3)).toContain('3 replies')
    expect(body).toContain('3 replies are waiting')
    expect(body).toContain('https://thewall.social/lobby')
    expect(body).toContain('mail')
  })

  it('counts one properly', () => {
    expect(digestSubject(1)).toBe('one reply is waiting')
    expect(digestText({ ...digest, unread: 1 }, 'https://x.test')).toContain('somebody answered you')
  })

  it('does not include what anybody said', () => {
    /*
     * Deliberate. The job of this email is to bring somebody back; a digest
     * complete enough to read instead of visiting is a digest that replaces the
     * place it is about. It carries a number and an address, and no content.
     */
    expect(body).not.toMatch(/wrote|said:|"/)
    expect(body.split('\n').length).toBeLessThan(12)
  })

  it('carries the way out, in the body', () => {
    expect(body).toContain(unsubscribeUrl('https://thewall.social', 'tok-123'))
    expect(body).toContain('notify off')
  })

  it('reminds them they asked for it', () => {
    // The single most useful line in any notification email, and the one that
    // stops it reading as something that arrived uninvited.
    expect(body).toContain('you asked for this')
  })
})

/**
 * The route sends mail to everybody who is due, so the things that keep it from
 * being a way to send mail are read out of the source — neither suite can reach
 * it, exactly as with the login route.
 */
describe('what keeps a mailing job from being anybody else’s to run', () => {
  const code = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'digest', 'route.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  it('is reading the file it thinks it is', () => {
    expect(code).toContain('pending_digests')
    expect(code).toContain('sendDigest')
  })

  it('is a POST, so a crawler cannot fire it', () => {
    expect(code).toMatch(/export async function POST/)
    expect(code).not.toMatch(/export async function GET/)
  })

  it('refuses without the shared secret', () => {
    expect(code).toContain('DIGEST_SECRET')
    expect(code).toContain('401')
  })

  it('is off rather than open when no secret is configured', () => {
    // The failure that turns a mailing job into somebody else's rate limit is a
    // deploy that forgot the variable and left the route unauthenticated.
    expect(code).toMatch(/if \(!secret\)/)
    expect(code).toContain('503')
  })

  it('stamps each send as it happens, not the whole batch at the end', () => {
    /*
     * This runs in a serverless function with a hard timeout. Collecting ids
     * and stamping once at the end means a run big enough to be cut off has
     * sent a pile of email and stamped none of it — so every one of those
     * people gets a second copy on the next run. The stamp has to be inside the
     * loop.
     */
    const loop = /for \(const row of batch\)[\s\S]*?\n  \}/.exec(code)?.[0] ?? ''
    expect(loop).toContain('mark_digested')
    expect(loop).toContain('p_ids: [row.profile_id]')
  })

  it('bounds a run, and says out loud when it did not finish', () => {
    // A run that quietly did half its work reads as a run that finished.
    expect(code).toContain('MAX_PER_RUN')
    expect(code).toMatch(/console\.warn/)
    expect(code).toContain('deferred')
  })

  it('compares the secret in constant time', () => {
    // The response time should not be a way to guess it one character at a
    // time, and the error path must not leak the length either.
    expect(code).toContain('timingSafeEqual')
    expect(code).not.toMatch(/offered !== secret/)
  })
})
