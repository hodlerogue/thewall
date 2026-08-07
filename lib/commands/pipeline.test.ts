import { describe, expect, it } from 'vitest'
import { parseFlags, parseSince, splitStages } from '@/lib/commands/pipeline'
import { chipsForContext, createRunner } from '@/lib/commands/run'
import { COMMANDS, findCommand } from '@/lib/commands/registry'
import { fixtureEnv } from '@/lib/shell/env'
import { ROOMS as FIXTURE_ROOMS } from '@/lib/shell/fixtures'
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
    async login(name: string) {
      return { ok: true as const, name, note: 'sent' }
    },
    async resend() {
      return { note: 'sent' }
    },
  },
  {
    async rename(name: string) {
      return { ok: true as const, name }
    },
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
    // `~name/2` is an address too — a wall is a room, and a search crosses it
    // like any other. Counting only `\w` slugs silently dropped them and made
    // the pipe look like it had lost rows.
    const total = (all.match(/^~?\w+\/\d+ /gm) ?? []).length

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
    const nobody = text((await run('find --by=nobody | count', LOBBY)).lines)
    expect(nobody).toBe('0 posts')

    /*
     * Everything jameson has said, posts and replies both.
     *
     * This asserted 2 for a long time, with a comment explaining that replies
     * are not posts. That was true of the implementation and never true of the
     * question: somebody asking what jameson has said means all of it. `find`
     * read the posts table directly, so on a site whose §4.3 shape is a post
     * and a flat list of answers it was silently missing most of what was said.
     *
     * Counted from the fixtures rather than written down. It said `4` and a
     * comment naming which four, and then adding two rooms made it 5 — a test
     * that fails whenever the demo content grows is a test that will eventually
     * be updated without being read. What it is actually asserting is below:
     * that replies are in the total.
     */
    const said = (author: string) =>
      FIXTURE_ROOMS.filter((room) => !room.ephemeral).flatMap((room) => [
        ...room.posts.filter((post) => post.author === author),
        ...room.posts.flatMap((post) => post.replies.filter((reply) => reply.author === author)),
      ])
    const posts = FIXTURE_ROOMS.filter((r) => !r.ephemeral).flatMap((r) =>
      r.posts.filter((p) => p.author === 'jameson'),
    )
    const expected = said('jameson').length

    // Or the assertion below passes without proving anything about replies.
    expect(expected).toBeGreaterThan(posts.length)

    const some = text((await run('find --by=jameson | count', LOBBY)).lines)
    expect(some).toBe(`${expected} posts`)
  })

  it('narrows by age', async () => {
    const recent = text((await run('find --since=1h | count', LOBBY)).lines)
    const ever = text((await run('find --since=7d | count', LOBBY)).lines)

    const n = (s: string) => Number(s.split(' ')[0])
    expect(n(recent)).toBeGreaterThan(0)
    // A tighter window can only ever return fewer.
    expect(n(recent)).toBeLessThan(n(ever))
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
    const out = text((await run('find --limit=100', LOBBY)).lines)
    expect(out).not.toMatch(/commons\//)
    // A phrase that exists only in commons, so this cannot pass by accident.
    expect(out).not.toMatch(/super keeps saying/)

    // Even searching for its exact words finds nothing there.
    expect(text((await run('find super keeps saying', LOBBY)).lines)).toMatch(/nothing said about/)
  })

  it('says nothing matched rather than showing an empty list', async () => {
    expect(text((await run('posts --by=nobody', LOBBY)).lines)).toBe('nothing matched.')
    expect(text((await run('posts --by=nobody | go', LOBBY)).lines)).toMatch(/nowhere to go/)
  })
})

describe('§4.8 — the pipe is not advertised, but the search is', () => {
  it('lists the search in help, because a search nobody can find is not one', async () => {
    const out = text((await run('help', LOBBY)).lines)
    expect(out).toMatch(/find — /)
  })

  it('still keeps the pipe out of help — that is what §4.8 asked to hide', async () => {
    for (const location of [LOBBY, { room: 'music' }, { room: 'music', postId: 12 }]) {
      const out = text((await run('help', location)).lines)
      expect(out).not.toMatch(/\|/)
      // Word boundaries, or this catches the "count" inside "account" — which
      // it did, the moment `login — get back into your account` was listed. A
      // substring match here reports a §4.8 leak for any word that happens to
      // contain a pipe verb, and the three it names are common English.
      expect(out).not.toMatch(/\bcount\b|--room|--since/)
    }
  })

  it('nothing marked hidden appears in any palette', () => {
    const hidden = COMMANDS.filter((c) => c.hidden).map((c) => c.verb)
    expect(hidden.length).toBeGreaterThan(0)

    for (const context of ['lobby', 'room', 'commons', 'post'] as const) {
      const shown = chipsForContext(context).map((c: { verb: string }) => c.verb)
      for (const verb of hidden) expect(shown, `${verb} in ${context}`).not.toContain(verb)
    }
  })

  it('explains itself in full to anyone who asks (§3.8)', async () => {
    const out = text((await run('what find', LOBBY)).lines)
    expect(out).toMatch(/^find — /)
    expect(out).toMatch(/--room/)
    expect(out).toMatch(/\| count/)
  })

  it('answers to posts too, which is the name §4.8 used', async () => {
    const out = text((await run('what posts', LOBBY)).lines)
    expect(out).toMatch(/^find — /)
  })
})

describe('searching for words — the thing anyone actually reaches for', () => {
  it('takes a bare word', async () => {
    const out = text((await run('find tomatoes', LOBBY)).lines)
    expect(out).toMatch(/tomatoes/)
    expect(out).toMatch(/kitchen\/|commons\//)
  })

  it('does not care about case', async () => {
    const upper = text((await run('find TOMATOES', LOBBY)).lines)
    const lower = text((await run('find tomatoes', LOBBY)).lines)
    expect(upper).toBe(lower)
  })

  it('takes more than one word', async () => {
    const out = text((await run('find pocket kings', LOBBY)).lines)
    expect(out).toMatch(/poker\//)
    expect(out).toMatch(/folded pocket kings/)
  })

  it('says what it looked for when it finds nothing', async () => {
    const out = text((await run('find xylophone', LOBBY)).lines)
    expect(out).toBe('nothing said about xylophone.')
  })

  it('combines words with flags', async () => {
    const both = text((await run('find tomatoes --room=kitchen', LOBBY)).lines)
    expect(both).toMatch(/kitchen\//)
    expect(both).not.toMatch(/commons\//)
  })

  it('pipes a word search like any other', async () => {
    const out = text((await run('find tomatoes | count', LOBBY)).lines)
    expect(out).toMatch(/^\d+ posts?$/)
  })

  it('answers to search and grep as well', async () => {
    const { parse } = await import('@/lib/commands/parse')
    for (const word of ['find', 'posts', 'search', 'grep']) {
      expect(parse(word)?.command?.verb, word).toBe('find')
    }
  })
})

describe('§4.8 — flags that teach when they are wrong (§3.7)', () => {
  it('answers the doc’s own --tag example with what to use instead', async () => {
    const out = text((await run('posts --tag=poker --since=7d', LOBBY)).lines)
    expect(out).toBe('there are no tags — rooms do that job. try: find --room=poker')
  })

  it('names the flags that exist', async () => {
    const out = text((await run('posts --author=ren', LOBBY)).lines)
    expect(out).toMatch(/i don’t know --author/)
    expect(out).toMatch(/--room, --rooms, --by, --since, --limit/)
  })

  it('explains a duration that is not one', async () => {
    const out = text((await run('posts --since=lately', LOBBY)).lines)
    expect(out).toMatch(/isn’t a length of time/)
    expect(out).toMatch(/7d/)
  })

  it('reads a bare word as the search rather than refusing it', async () => {
    // This used to answer "posts takes flags, not words", which turned away
    // the most obvious way anyone would reach for a search.
    const out = text((await run('find garage', LOBBY)).lines)
    expect(out).toMatch(/records in the garage/)
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
    const inputs = ['find --tag=x', 'find --nope', 'find | star', 'find --since=soon']
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
      if (command.pipeable) expect(command.verb).toBe('find')
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
