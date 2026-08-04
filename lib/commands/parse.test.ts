import { describe, expect, it } from 'vitest'
import { parse } from '@/lib/commands/parse'
import { COMMANDS, findCommand, nearestCommand } from '@/lib/commands/registry'
import { chipsForContext, createRunner } from '@/lib/commands/run'
import { fixtureEnv } from '@/lib/shell/env'
import { Session } from '@/lib/shell/session'
import { locationToPath, pathToLocation, promptLabel } from '@/lib/shell/types'
import type { Context, Location } from '@/lib/shell/types'

const EPHEMERAL = ['commons']

// These tests are about parsing and navigation, so they run as someone who
// already has a name — the signup flow has its own suite.
const signedIn = new Session(
  { async checkName() { return { available: true, alternates: [] } },
    async create(name) { return { ok: true as const, name } },
    async resend() { return { note: 'sent' } } },
  { async post() { return 1 }, async reply() {},
    async rename(name) { return { ok: true as const, name } } },
  'tester',
)
const run = createRunner(fixtureEnv(), EPHEMERAL, signedIn)
const text = (lines: { text: string }[]) => lines.map((l) => l.text).join('\n')

/**
 * The §3.5 table, transcribed from the doc rather than from the code.
 *
 * One departure, recorded rather than quietly made: the doc lists `reply` as an
 * alias for `say`, on §3.3's reasoning that there is no reply verb to learn.
 * It cost more than it saved. Aliases are never announced (§3.5), so nobody
 * could discover it — and in a *room* it resolved to `say` and posted a brand
 * new post, which is the opposite of what typing "reply" asks for. It is a
 * command of its own now, which does nothing `say` cannot but appears in help
 * everywhere and teaches the step people are missing.
 */
const ALIAS_TABLE: Record<string, string[]> = {
  look: ['ls', 'see', 'list', 'show', 'rooms'],
  go: ['cd', 'enter', 'open', 'join', 'read'],
  say: ['wall', 'post', 'write', 'talk'],
  reply: ['re', 'answer'],
  who: ['people', 'online', 'users'],
  leave: ['back', 'exit', 'up', 'cd ..'],
  what: ['man', 'explain', 'info', '?'],
  help: ['commands', 'h'],
}

describe('§3.5 — english verbs are canonical, unix names are aliases', () => {
  for (const [canonical, aliases] of Object.entries(ALIAS_TABLE)) {
    it(`${canonical} and its ${aliases.length} aliases all resolve to ${canonical}`, () => {
      expect(parse(canonical)?.command?.verb).toBe(canonical)
      for (const alias of aliases) {
        expect(parse(alias)?.command?.verb, `alias: ${alias}`).toBe(canonical)
      }
    })
  }

  it('resolves aliases carrying arguments', () => {
    expect(parse('cd music')).toMatchObject({ arg: 'music' })
    expect(parse('cd music')?.command?.verb).toBe('go')
    expect(parse('answer nice one')).toMatchObject({ arg: 'nice one' })
    expect(parse('answer nice one')?.command?.verb).toBe('reply')
  })

  it('is case-insensitive and tolerates extra whitespace', () => {
    expect(parse('  LOOK  ')?.command?.verb).toBe('look')
    expect(parse('GO   music')).toMatchObject({ arg: 'music' })
  })

  it('never announces the aliasing — no gloss mentions a unix name', () => {
    const contexts: Context[] = ['lobby', 'room', 'commons', 'post']
    const unix = ['ls', 'cd', 'man', 'motd', 'wall']
    for (const command of COMMANDS) {
      for (const context of contexts) {
        for (const name of unix) {
          expect(command.gloss(context).split(/\s+/)).not.toContain(name)
        }
      }
    }
  })
})

describe('§3.7 — errors teach', () => {
  it('guesses the nearest verb AND shows its description', async () => {
    for (const typo of ['lok', 'goo', 'sya', 'helo', 'wht']) {
      const out = text((await run(typo, { room: 'music' })).lines)
      expect(out, `typo: ${typo}`).toMatch(/did you mean/)
      // The description is the part that teaches; a bare verb would not.
      expect(out, `typo: ${typo}`).toMatch(/—/)
    }
  })

  it('resolves typos to the right verb', () => {
    expect(nearestCommand('lok')?.verb).toBe('look')
    expect(nearestCommand('sya')?.verb).toBe('say')
    expect(nearestCommand('leav')?.verb).toBe('leave')
  })

  it('falls back to help rather than guessing wildly', async () => {
    const out = text((await run('xyzzy', { room: 'music' })).lines)
    expect(out).not.toMatch(/did you mean/)
    expect(out).toMatch(/help/)
  })

  it('names the fix when a command is used from the wrong place', async () => {
    const out = text((await run('say hello', {})).lines)
    expect(out).toBe('you have to be in a room first. try: go music')
  })

  it('never emits error codes or "invalid syntax"', async () => {
    const inputs = ['zzz', 'say hi', 'go', 'go 99', 'what zzz']
    for (const input of inputs) {
      const out = text((await run(input, {})).lines).toLowerCase()
      expect(out, input).not.toMatch(/invalid|syntax|error|\bE\d+\b/)
    }
  })

  it('suggests a real room when the room name is close', async () => {
    const out = text((await run('go musci', {})).lines)
    expect(out).toMatch(/did you mean music\?/)
  })
})

describe('§3.4 — post ids are addresses, not positions', () => {
  it('opens a post by its permanent id, not its place in the list', async () => {
    // music lists post 12 first and post 11 second; `go 11` must reach 11.
    const result = await run('go 11', { room: 'music' })
    expect(result.location).toEqual({ room: 'music', postId: 11 })
    expect(text(result.lines)).toMatch(/bass player/)
  })

  it('says so plainly when the id is not there', async () => {
    const out = text((await run('go 99', { room: 'music' })).lines)
    expect(out).toBe('there’s no post 99 in music. try: look')
  })

  it('explains that post numbers need a room, and names one', async () => {
    const out = text((await run('go 12', {})).lines)
    expect(out).toBe('post numbers only work inside a room. try: go music first.')
  })
})

describe('§3.10 — commons keeps nothing', () => {
  it('refuses to open a post there, because there are none to open', async () => {
    const out = text((await run('go 1', { room: 'commons' })).lines)
    expect(out).toMatch(/doesn’t keep posts/)
  })

  it('shows no post numbers in its listing', async () => {
    const out = text((await run('look', { room: 'commons' })).lines)
    expect(out).toMatch(/gone in 24 hours/)
    expect(out).not.toMatch(/^\d+\s{2}/m)
  })

  it('still allows saying something — it is a hallway, not a wall', async () => {
    const out = text((await run('say hello', { room: 'commons' })).lines)
    expect(out).not.toMatch(/you have to be in a room/)
  })
})

describe('§3.1 — navigation', () => {
  it('leave backs out one level, from anywhere', async () => {
    expect((await run('leave', { room: 'music', postId: 12 })).location).toEqual({ room: 'music' })
    expect((await run('leave', { room: 'music' })).location).toEqual({})
    expect(text((await run('leave', {})).lines)).toMatch(/already at the lobby/)
  })

  it('accepts a room name from anywhere, the way an absolute path works', async () => {
    const fromPost = await run('go poker', { room: 'music', postId: 12 })
    expect(fromPost.location).toEqual({ room: 'poker' })
  })
})

describe('§3.8 — what <command> replaces man', () => {
  it('leads with plain english and lists aliases second', async () => {
    const lines = (await run('what go', {})).lines
    expect(lines[0].text).toMatch(/^go — /)
    expect(lines[1].text).not.toMatch(/^also:/)
    expect(lines.at(-1)!.text).toMatch(/^also: cd, enter, open, join, read$/)
  })

  it('works when you ask about an alias', async () => {
    const lines = (await run('what ls', {})).lines
    expect(lines[0].text).toMatch(/^look — /)
  })

  it('every command explains itself', () => {
    for (const command of COMMANDS) {
      expect(command.detail('room').length, command.verb).toBeGreaterThan(20)
    }
  })
})

describe('§3.6 — the palette is a glossary derived from the registry', () => {
  const contexts: Context[] = ['lobby', 'room', 'commons', 'post']

  it('never exceeds ~6 items in any context', () => {
    for (const context of contexts) {
      expect(chipsForContext(context).length, context).toBeLessThanOrEqual(6)
    }
  })

  it('only offers commands that work where you are standing', () => {
    for (const context of contexts) {
      for (const chip of chipsForContext(context)) {
        expect(findCommand(chip.verb)!.contexts, `${chip.verb} in ${context}`).toContain(context)
      }
    }
  })

  it('reads `verb — what it does`, never a bare verb', () => {
    for (const context of contexts) {
      for (const chip of chipsForContext(context)) {
        expect(chip.gloss.length, `${chip.verb} in ${context}`).toBeGreaterThan(3)
      }
    }
  })

  it('leaves a trailing space exactly when an argument follows', () => {
    for (const context of contexts) {
      for (const chip of chipsForContext(context)) {
        const takesArg = ['go', 'say', 'what', 'theme', 'find'].includes(chip.verb)
        expect(chip.insert.endsWith(' '), `${chip.verb} in ${context}`).toBe(takesArg)
      }
    }
  })

  it('inserts text that actually parses back to the same command', () => {
    for (const context of contexts) {
      for (const chip of chipsForContext(context)) {
        expect(parse(chip.insert)?.command?.verb).toBe(chip.verb)
      }
    }
  })
})

describe('commands that need no data do not ask for any', () => {
  /** An Env that counts reads and fails on all of them. */
  function brokenEnv() {
    let reads = 0
    const boom = () => {
      reads += 1
      throw new Error('the database is having a moment')
    }
    return {
      reads: () => reads,
      env: {
        listRooms: boom,
        getRoom: boom,
        getPost: boom,
        who: boom,
        searchPosts: boom,
      } as unknown as ReturnType<typeof fixtureEnv>,
    }
  }

  it('help and what work while the database is down', async () => {
    const { env, reads } = brokenEnv()
    const offline = createRunner(env, EPHEMERAL, signedIn)

    for (const input of ['help', 'what go', 'what', 'zzz']) {
      const out = text((await offline(input, { room: 'music' })).lines)
      expect(out.length, input).toBeGreaterThan(0)
    }

    // The room hint used to be resolved before dispatch, so every command —
    // including the two a confused person reaches for — cost a query, and
    // failed with it.
    expect(reads()).toBe(0)
  })

  it('but a wrong-context error still names a real room', async () => {
    // `say` at the lobby has to suggest somewhere that exists, so this one
    // genuinely needs the lookup.
    const out = text((await run('say hello', {})).lines)
    expect(out).toBe('you have to be in a room first. try: go music')
  })
})

describe('the prompt path is the url path (§3.4)', () => {
  const cases: [Location, string][] = [
    // The lobby has its own address so `/` can put arrivals in commons (§3.10)
    // without making `leave` impossible.
    [{}, '/lobby'],
    [{ room: 'music' }, '/music'],
    [{ room: 'music', postId: 12 }, '/music/12'],
  ]

  it('turns every location into a path', () => {
    for (const [location, path] of cases) expect(locationToPath(location)).toBe(path)
  })

  it('turns every path back into the same location', () => {
    for (const [location, path] of cases) expect(pathToLocation(path)).toEqual(location)
  })

  it('reads / as the lobby, since that is where the redirect starts from', () => {
    expect(pathToLocation('/')).toEqual({})
  })

  it('ignores a post segment that was never an address', () => {
    expect(pathToLocation('/music/twelve')).toEqual({ room: 'music' })
  })

  it('agrees with the prompt about where you are', () => {
    expect(promptLabel(null, pathToLocation('/music/12'))).toBe('guest:music/12$')
    expect(promptLabel('jameson', pathToLocation('/music/12'))).toBe('jameson:music/12$')
    expect(promptLabel('jameson', pathToLocation('/lobby'))).toBe('jameson:lobby$')
  })
})
