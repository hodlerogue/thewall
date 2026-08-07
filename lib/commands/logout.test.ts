import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRunner } from '@/lib/commands/run'
import { findCommand } from '@/lib/commands/registry'
import { fixtureEnv } from '@/lib/shell/env'
import { renderProfile } from '@/lib/shell/render'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Profile } from '@/lib/shell/model'
import type { Line, Location } from '@/lib/shell/types'

/**
 * Leaving a device.
 *
 * There was no way to do this at all: nothing in the codebase called `signOut`,
 * there was no verb for it, and the session cookie lasts four hundred days. So
 * signing in on a borrowed phone was a four-hundred-day decision made by
 * somebody who thought they were reading a website.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')
const LOBBY: Location = {}

function harness(options: { me?: string | null; fail?: string } = {}) {
  let calls = 0

  const api: SignupApi = {
    async checkName() {
      return { available: true, alternates: [] }
    },
    async create(name) {
      return { ok: true as const, name }
    },
    async login(name) {
      return { ok: true as const, name, note: 'sent' }
    },
    async logout() {
      calls += 1
      return options.fail ? { ok: false as const, reason: options.fail } : { ok: true as const }
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
  return { session, run: createRunner(fixtureEnv(), ['commons'], session), calls: () => calls }
}

describe('logout', () => {
  it('ends the session and stops the prompt saying who you were', async () => {
    const { run, session } = harness()
    const result = await run('logout', LOBBY)

    expect(session.name()).toBe(null)
    // The prompt reads its name from this. Without it the session is over and
    // the prompt still says `ryan`, which is the one thing this must not do.
    expect(result.identity).toBe(null)
    expect(text(result.lines)).toContain('isn’t ryan anymore')
  })

  it('says the posts stay, because "log out" reads as "remove me" to plenty of people', async () => {
    const out = text((await harness().run('logout', LOBBY)).lines)
    expect(out).toMatch(/still there/)
    expect(out).toContain('login ryan')
  })

  it('does not claim you are out when the sign-out failed', async () => {
    /*
     * The worst answer available here. Somebody walks away from a shared
     * machine believing something untrue, and the cookie lasts four hundred
     * days.
     */
    const { run, session } = harness({ fail: 'couldn’t sign you out just now.' })
    const result = await run('logout', LOBBY)

    expect(text(result.lines)).toContain('couldn’t sign you out')
    expect(session.name()).toBe('ryan')
    expect(result.identity).toBe('ryan')
  })

  it('says you are already a guest rather than pretending to do something', async () => {
    const { run, calls } = harness({ me: null })
    expect(text((await run('logout', LOBBY)).lines)).toContain('already reading as a guest')
    expect(calls()).toBe(0)
  })

  it('is an answer, not a command, while a question is on screen', async () => {
    /*
     * The first version of this test built a state that cannot happen — a
     * held sentence belonging to somebody who already has a name — and failed
     * for that reason rather than for a bug. What is actually true is worth
     * pinning instead.
     *
     * Mid-signup everything typed is an answer (§3.9), which is what stops
     * accounts being called `look`, and `logout` is no different. There is also
     * nothing to log out *of*: being asked for a name means there is no session
     * yet. `cancel` is the way out of a question, and it already is one.
     */
    const { session, run, calls } = harness({ me: null })
    session.begin({ location: { room: 'music' }, body: 'a thing i was saying' })

    await run('logout', LOBBY)
    expect(calls()).toBe(0)

    const out = text((await run('cancel', LOBBY)).lines)
    expect(out).toMatch(/nothing sent/)
    expect(session.isAsking()).toBe(false)
  })

  it('is in help, since the person who needs it is at somebody else’s machine', async () => {
    // A verb you have to already know is a verb that is not there, for exactly
    // the reader this exists for.
    expect(text((await harness().run('help', LOBBY)).lines)).toContain('logout — leave this device')
  })

  it('does not take a word anybody else already owns', async () => {
    // `exit` is `leave`'s, and `back` is too — both are said out loud during
    // signup. Two meanings for one word is how a shell stops being predictable.
    for (const word of ['logout', 'signout', 'bye']) {
      expect(findCommand(word)?.verb, word).toBe('logout')
    }
    expect(findCommand('exit')?.verb).toBe('leave')
  })
})

describe('what makes a sign-out real', () => {
  const code = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'logout', 'route.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  it('is reading the file it thinks it is', () => {
    expect(code).toContain('createRouteClient')
  })

  it('signs out server-side, where the cookie was written', () => {
    // Signup mints the session on the server and hands it back as `Set-Cookie`.
    // A browser-only `signOut` leaves whatever the server wrote, and the next
    // page load reads it straight back.
    expect(code).toContain('signOut')
    expect(code).toMatch(/export async function POST/)
  })

  it('ends this device only', () => {
    // Stepping off a shared laptop should not sign you out of your own phone.
    expect(code).toContain("scope: 'local'")
  })

  it('reports a failure rather than swallowing it', () => {
    expect(code).toMatch(/status: 500/)
  })
})

describe('a profile says one thing that is true of every line on it', () => {
  /*
   * Reported: "I've posted in music and poker. I go in and it says 'these live
   * in rooms — go poker, then go 4'. That's true for the most recent post but
   * not for any of the others, so it's just confusing."
   *
   * Exactly right. The closing line was a two-step recipe built from whichever
   * post happened to be newest, printed under a list that spans rooms.
   */
  const profile: Profile = {
    name: 'ryan',
    joinedAt: new Date(Date.now() - 86_400_000),
    verified: true,
    posts: [
      { room: 'poker', id: 4, author: 'ryan', body: 'folded it', createdAt: new Date(Date.now() - 60_000) },
      { room: 'music', id: 12, author: 'ryan', body: 'warped records', createdAt: new Date(Date.now() - 600_000) },
    ],
  }

  it('gives one step, not two', () => {
    const out = text(renderProfile(profile))
    expect(out).not.toMatch(/then go/)
    expect(out).toContain('go poker/4')
  })

  it('names the shape rather than one post’s route', () => {
    // The difference that matters: "each of those is an address" is true of the
    // music line as well, where "go poker, then go 4" was not.
    expect(text(renderProfile(profile))).toMatch(/each of those is an address/)
  })

  it('says the same thing for a wall post, instead of a second sentence', () => {
    // There used to be a branch here, because `go 7` needs you to already be in
    // the room. A whole address does not, so both cases are one sentence.
    const wall: Profile = {
      ...profile,
      posts: [
        { room: '~ryan', id: 3, author: 'ryan', body: 'on my wall', createdAt: new Date() },
      ],
    }
    const out = text(renderProfile(wall))
    expect(out).toContain('go ~ryan/3')
    expect(out).toMatch(/each of those is an address/)
  })
})
