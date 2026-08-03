import { describe, expect, it } from 'vitest'
import { parseFlags, parseSince, splitStages } from '@/lib/commands/pipeline'
import { chipsForContext, createRunner } from '@/lib/commands/run'
import { COMMANDS, findCommand } from '@/lib/commands/registry'
import { fixtureEnv } from '@/lib/shell/env'
import { Session } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')

const posted: string[] = []
const session = new Session(
  {
    async checkName() {
      return { available: true, alternates: [] }
    },
    async create(name) {
      return { ok: true as const, name }
    },
  },
  {
    async post(_room, body) {
      posted.push(body)
      return 1
    },
    async reply(_room, _no, body) {
      posted.push(body)
    },
  },
  'tester',
)

const run = createRunner(fixtureEnv(), ['commons'], session)
const LOBBY: Location = {}

describe('§4.8 — one working pipe', () => {
  it('finds posts across rooms, each with an address you can go to', async () => {
    const out = text((await run('posts', LOBBY)).lines)
    expect(out).toMatch(/music\/12/)
    expect(out).toMatch(/poker\/4/)
    expect(out).toMatch(/records in the garage/)
  })

  it('pipes into count', async () => {
    const all = text((await run('posts', LOBBY)).lines)
    const total = (all.match(/^\w+\/\d+ /gm) ?? []).length

    const counted = text((await run('posts | count', LOBBY)).lines)
    expect(counted).toBe(`${total} posts`)
  })

  it('pipes into go, which moves you to the newest match', async () => {
    const result = await run('posts --room=music | go', LOBBY)
    // music's newest post is 12, not 11.
    expect(result.location).toEqual({ room: 'music', postId: 12 })
    expect(text(result.lines)).toMatch(/records in the garage/)
  })

  it('narrows by author', async () => {
    const out = text((await run('posts --by=marisol | count', LOBBY)).lines)
    expect(out).toBe('0 posts')

    const mine = text((await run('posts --by=jameson | count', LOBBY)).lines)
    expect(mine).toBe('1 post')
  })

  it('narrows by age', async () => {
    // The kitchen post is 5h old, latenight's oldest is 8h.
    expect(text((await run('posts --since=1h | count', LOBBY)).lines)).toBe('0 posts')
    expect(text((await run('posts --since=7d | count', LOBBY)).lines)).not.toBe('0 posts')
  })

  it('narrows by limit', async () => {
    expect(text((await run('posts --limit=2 | count', LOBBY)).lines)).toBe('2 posts')
  })

  it('takes the room you are standing in as a filter', async () => {
    const here = text((await run('posts | count', { room: 'poker' })).lines)
    const explicit = text((await run('posts --room=poker | count', LOBBY)).lines)
    expect(here).toBe(explicit)
  })

  it('lets --room override where you are standing', async () => {
    const out = text((await run('posts --room=kitchen', { room: 'poker' })).lines)
    expect(out).toMatch(/kitchen\//)
    expect(out).not.toMatch(/poker\//)
  })

  it('never returns commons posts, which have no address to go to', async () => {
    const out = text((await run('posts --limit=100', LOBBY)).lines)
    expect(out).not.toMatch(/commons\//)
    expect(out).not.toMatch(/tomatoes/)
  })

  it('says nothing matched rather than showing an empty list', async () => {
    expect(text((await run('posts --by=nobody', LOBBY)).lines)).toBe('nothing matched.')
    expect(text((await run('posts --by=nobody | go', LOBBY)).lines)).toMatch(/nowhere to go/)
  })
})

describe('§4.8 — the pipe is not advertised', () => {
  it('is absent from help', async () => {
    for (const location of [LOBBY, { room: 'music' }, { room: 'music', postId: 12 }]) {
      const out = text((await run('help', location)).lines)
      expect(out).not.toMatch(/\bposts\b/)
    }
  })

  it('is absent from every palette', () => {
    for (const command of COMMANDS) {
      if (!command.hidden) continue
      expect(command.verb).toBe('posts')
    }
    for (const context of ['lobby', 'room', 'commons', 'post'] as const) {
      expect(chipsForContext(context).map((c: { verb: string }) => c.verb)).not.toContain('posts')
    }
  })

  it('is never offered as a "did you mean"', async () => {
    // `post` is an alias of `say`, and near-misses must not leak the pipe.
    for (const typo of ['post', 'poss', 'pots', 'postts']) {
      const out = text((await run(typo, { room: 'music' })).lines)
      expect(out, typo).not.toMatch(/did you mean posts/)
    }
  })

  it('but explains itself in full to anyone who asks (§3.8)', async () => {
    const out = text((await run('what posts', LOBBY)).lines)
    expect(out).toMatch(/^posts — /)
    expect(out).toMatch(/--room/)
    expect(out).toMatch(/\| count/)
  })
})

describe('§4.8 — flags that teach when they are wrong (§3.7)', () => {
  it('answers the doc’s own --tag example with what to use instead', async () => {
    const out = text((await run('posts --tag=poker --since=7d', LOBBY)).lines)
    expect(out).toBe('there are no tags — rooms do that job. try: posts --room=poker')
  })

  it('names the flags that exist', async () => {
    const out = text((await run('posts --author=ren', LOBBY)).lines)
    expect(out).toMatch(/i don’t know --author/)
    expect(out).toMatch(/--room, --by, --since, --limit/)
  })

  it('explains a duration that is not one', async () => {
    const out = text((await run('posts --since=lately', LOBBY)).lines)
    expect(out).toMatch(/isn’t a length of time/)
    expect(out).toMatch(/7d/)
  })

  it('redirects bare words to the flag that was meant', async () => {
    const out = text((await run('posts jameson', LOBBY)).lines)
    expect(out).toBe('posts takes flags, not words. try: posts --by=jameson')
  })

  it('refuses a sink it cannot pipe into, and names the ones it can', async () => {
    const out = text((await run('posts | star', LOBBY)).lines)
    expect(out).toMatch(/can’t pipe into star/)
    expect(out).toMatch(/\| count/)
  })

  it('rejects a nonsense limit', async () => {
    for (const bad of ['0', '-3', 'lots', '1000']) {
      expect(text((await run(`posts --limit=${bad}`, LOBBY)).lines), bad).toMatch(/whole number/)
    }
  })

  it('never says invalid syntax', async () => {
    const inputs = ['posts --tag=x', 'posts --nope', 'posts | star', 'posts --since=soon']
    for (const input of inputs) {
      expect(text((await run(input, LOBBY)).lines).toLowerCase(), input).not.toMatch(
        /invalid|syntax|error/,
      )
    }
  })
})

describe('a pipe character is only special where it was invited', () => {
  it('leaves it alone inside a sentence (§3.3)', async () => {
    posted.length = 0
    await run('say the chord was a|b|c and it worked', { room: 'music' })
    expect(posted).toEqual(['the chord was a|b|c and it worked'])
  })

  it('only the pipe source opts in', () => {
    for (const command of COMMANDS) {
      if (command.pipeable) expect(command.verb).toBe('posts')
    }
    expect(findCommand('say')?.pipeable).toBeUndefined()
  })
})

describe('pipeline parsing', () => {
  it('splits stages and drops empty ones', () => {
    expect(splitStages('posts --by=x | count')).toEqual([
      { head: 'posts', rest: '--by=x' },
      { head: 'count', rest: '' },
    ])
    expect(splitStages('  |  count  |  ')).toEqual([{ head: 'count', rest: '' }])
  })

  it('reads flags with and without values, and keeps loose words', () => {
    const { values, loose } = parseFlags('--room=music --bare hello --limit=5')
    expect(values.get('room')).toBe('music')
    expect(values.get('bare')).toBe('')
    expect(values.get('limit')).toBe('5')
    expect(loose).toEqual(['hello'])
  })

  it('reads durations, and refuses things that are not', () => {
    const now = new Date('2026-08-03T12:00:00Z')
    expect(parseSince('2h', now)?.toISOString()).toBe('2026-08-03T10:00:00.000Z')
    expect(parseSince('7d', now)?.toISOString()).toBe('2026-07-27T12:00:00.000Z')
    expect(parseSince('30m', now)?.toISOString()).toBe('2026-08-03T11:30:00.000Z')
    expect(parseSince('1w', now)?.toISOString()).toBe('2026-07-27T12:00:00.000Z')

    for (const bad of ['', 'soon', '7', 'd7', '0d', '-1d']) {
      expect(parseSince(bad, now), bad).toBeNull()
    }
  })
})
