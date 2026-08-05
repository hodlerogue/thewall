import { describe, expect, it } from 'vitest'
import { CHIP_SETS, COMMANDS, findCommand } from '@/lib/commands/registry'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv } from '@/lib/shell/env'
import { ROOMS } from '@/lib/shell/fixtures'
import { renderRoomList, LOBBY_LIMIT } from '@/lib/shell/render'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { RoomSummary } from '@/lib/shell/model'
import type { Line, Location } from '@/lib/shell/types'

/**
 * §4.2, reopened — and the half of it that has to keep being true.
 *
 * The doc closes room creation because "40 rooms with three people each kills
 * the entire feeling". That is a claim about the *lobby*, so the property under
 * test is not that rooms can be made — it is that making them cannot turn the
 * front page into a directory.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')

function harness(me: string | null = 'jameson') {
  const api: SignupApi = {
    async checkName() {
      return { available: true, alternates: [] }
    },
    async create(name) {
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
    async rename(name: string) {
      return { ok: true as const, name }
    },
  }
  // A copy of the fixtures, because making a room mutates the array it is given
  // and the other suites read the shared one.
  const rooms = ROOMS.map((room) => ({ ...room, posts: [...room.posts] }))
  const session = new Session(api, writer, me)
  return { run: createRunner(fixtureEnv(rooms), ['commons'], session), rooms }
}

const LOBBY: Location = {}

describe('making a room', () => {
  it('takes the name and what it is for on one line, and walks you in', async () => {
    const { run, rooms } = harness()
    const result = await run('make garden what you are growing', LOBBY)

    expect(result.location).toEqual({ room: 'garden' })
    expect(text(result.lines)).toContain('garden is open')
    expect(rooms.some((room) => room.slug === 'garden')).toBe(true)
  })

  it('asks what it is for, rather than refusing the line', async () => {
    /*
     * `make onions` used to come back as an error telling somebody to retype
     * what they had just typed with more on the end — which reads as a syntax
     * error, and §3.7 says nothing here may be one.
     *
     * Its example was worse than the refusal. `try: make onions what you are
     * growing` filled in a description belonging to a different room, and it
     * was copied verbatim, because an example somebody is told to try is an
     * instruction. A room ended up called onions and glossed "what you are
     * growing", and the error had written it.
     */
    const { run, rooms } = harness()
    const asked = text((await run('make onions', LOBBY)).lines)

    expect(asked).toContain('what is onions for?')
    expect(asked).not.toContain('what you are growing')
    // Nothing exists yet — the question is the whole of what happened.
    expect(rooms.some((room) => room.slug === 'onions')).toBe(false)
  })

  it('opens it on the answer, and walks you in', async () => {
    const { run, rooms } = harness()
    await run('make onions', LOBBY)
    const result = await run('the allium bed, and what to do with it', LOBBY)

    expect(text(result.lines)).toContain('onions is open')
    // The prompt has to follow. Answering used to print "you are in it" while
    // the label still said where you had been, because the answer path had no
    // way to report a move.
    expect(result.location).toEqual({ room: 'onions' })

    const made = rooms.find((room) => room.slug === 'onions')!
    expect(made.gloss).toBe('the allium bed, and what to do with it')
  })

  it('still takes both on one line, for anybody who prefers that', async () => {
    const { run, rooms } = harness()
    const result = await run('make onions the allium bed', LOBBY)

    expect(result.location).toEqual({ room: 'onions' })
    expect(rooms.find((room) => room.slug === 'onions')!.gloss).toBe('the allium bed')
  })

  it('keeps asking rather than opening a room with no gloss', async () => {
    const { run, rooms } = harness()
    await run('make onions', LOBBY)
    const empty = text((await run('   ', LOBBY)).lines)

    expect(empty).toContain('still waiting')
    expect(rooms.some((room) => room.slug === 'onions')).toBe(false)
  })

  it('lets you back out of the question with nothing made', async () => {
    const { run, rooms } = harness()
    await run('make onions', LOBBY)
    const out = text((await run('cancel', LOBBY)).lines)

    expect(out).toContain('nothing sent')
    expect(rooms.some((room) => room.slug === 'onions')).toBe(false)
  })

  it('refuses a name that is not a name, and says what one is', async () => {
    const { run } = harness()
    const out = text((await run('make garden! what you are growing', LOBBY)).lines)
    expect(out).toContain('2 to 24 characters')
  })

  it('takes the first word as the name, and says which room it made', async () => {
    // The contract is "first word names it, the rest says what it is for", so
    // `make My Room a place` makes `my`. That is a surprising outcome to type
    // your way into, and the confirmation is what keeps it from being a silent
    // one: it names the room, in accent, as the first line back.
    const { run } = harness()
    const result = await run('make My Room a place for things', LOBBY)
    expect(result.location).toEqual({ room: 'my' })
    expect(result.lines[0].text).toBe('my is open. you are in it.')
    expect(result.lines[0].tone).toBe('accent')
  })

  it('refuses a name already taken, and points at the room that has it', async () => {
    const { run } = harness()
    const out = text((await run('make music more music', LOBBY)).lines)
    expect(out).toContain('already exists')
    expect(out).toContain('go music')
  })

  it('does not ask a nameless visitor to sign up for it', async () => {
    // §3.9 puts the signup ask at the moment of contribution. A room is not a
    // sentence — there is nothing held to post afterwards, so the ask would
    // arrive with nothing to hand back.
    const { run, rooms } = harness(null)
    const before = rooms.length
    const out = text((await run('make garden what you are growing', LOBBY)).lines)

    expect(out).toContain('you need a name first')
    expect(out).not.toMatch(/what do you want to be called/)
    expect(rooms.length).toBe(before)
  })

  it('is in help, and answers to the words people reach for', async () => {
    const { run } = harness()
    expect(text((await run('help', LOBBY)).lines)).toMatch(/make — /)
    for (const word of ['make', 'create', 'new', 'mkdir']) {
      expect(findCommand(word)?.verb, word).toBe('make')
    }
  })

  it('is not in the palette — it is rare, and the palette has six slots', () => {
    for (const context of Object.keys(CHIP_SETS) as (keyof typeof CHIP_SETS)[]) {
      expect(CHIP_SETS[context], context).not.toContain('make')
    }
    // Being off the palette is not being hidden: `help` and `what` both have it.
    expect(COMMANDS.find((c) => c.verb === 'make')!.hidden).toBeFalsy()
  })
})

describe('the lobby stays a building, not a directory (§4.2)', () => {
  const room = (slug: string, curated: boolean): RoomSummary => ({
    slug,
    gloss: `what ${slug} is for`,
    ephemeral: false,
    curated,
    latest: { author: 'someone', body: 'a thing', createdAt: new Date() },
  })

  it('shows everything while there is little', () => {
    const out = text(renderRoomList([room('a', true), room('b', false)]))
    expect(out).toContain('a')
    expect(out).toContain('b')
    expect(out).not.toContain('more room')
  })

  it('caps the list and says how to reach the rest', () => {
    const many = [
      ...Array.from({ length: 6 }, (_, i) => room(`curated${i}`, true)),
      ...Array.from({ length: 20 }, (_, i) => room(`made${i}`, false)),
    ]
    const lines = renderRoomList(many)
    const slugs = lines.filter((l) => l.tone === 'accent').map((l) => l.text)

    expect(slugs.length).toBe(LOBBY_LIMIT)
    // Nothing is hidden — the rest are one command away, and the line says so.
    expect(text(lines)).toContain('14 more rooms')
    expect(text(lines)).toContain('find --rooms')
  })

  it('never drops a curated room to make space for a new one', () => {
    const many = [
      ...Array.from({ length: 6 }, (_, i) => room(`curated${i}`, true)),
      ...Array.from({ length: 40 }, (_, i) => room(`made${i}`, false)),
    ]
    const shown = renderRoomList(many).filter((l) => l.tone === 'accent').map((l) => l.text)

    for (let i = 0; i < 6; i++) expect(shown).toContain(`curated${i}`)
  })

  it('shows only curated ones if that is already the whole cap', () => {
    const many = [
      ...Array.from({ length: 12 }, (_, i) => room(`curated${i}`, true)),
      ...Array.from({ length: 5 }, (_, i) => room(`made${i}`, false)),
    ]
    const shown = renderRoomList(many).filter((l) => l.tone === 'accent').map((l) => l.text)
    expect(shown.length).toBe(12)
    expect(shown.every((slug) => slug.startsWith('curated'))).toBe(true)
  })
})

describe('finding a room', () => {
  it('searches names and what rooms are for', async () => {
    const { run } = harness()

    const byName = text((await run('find --rooms kitchen', LOBBY)).lines)
    expect(byName).toContain('kitchen')

    const byGloss = text((await run('find --rooms listening', LOBBY)).lines)
    expect(byGloss).toContain('music')
  })

  it('says so when there is no such room', async () => {
    const { run } = harness()
    expect(text((await run('find --rooms xylophone', LOBBY)).lines)).toContain('no room called xylophone')
  })

  it('does not hijack --room, which has always filtered posts', async () => {
    // `--rooms?` was the first spelling of this and matched `--room=music` too,
    // turning every existing filter into a room search.
    const { run } = harness()
    const out = text((await run('find --room=music records', LOBBY)).lines)
    expect(out).toContain('music/12')
    expect(out).not.toContain('what music is for')
  })

  it('points at a room when nothing was said about the word', async () => {
    const { run } = harness()
    const out = text((await run('find latenight', LOBBY)).lines)
    expect(out).toContain('nothing said about latenight')
    // …but there is a room by that name, which is what you meant.
    expect(out).toContain('quiet hours only')
  })

  it('offers a way in', async () => {
    const { run } = harness()
    expect(text((await run('find --rooms kitchen', LOBBY)).lines)).toContain('go kitchen')
  })
})


describe('the fixture Env cannot quietly disagree with the real one', () => {
  /*
   * The e2e suite runs entirely against fixtures, so a fixture that lies is not
   * a small problem — it is a green suite over a broken site. Two of these were
   * already true and one was not: `search_said` covered replies while the
   * fixture did not, which made "find reaches replies" a claim proved only in
   * the database suite and false in the app anybody actually clicked.
   */
  it('searches replies, because the database does', async () => {
    const { run } = harness()
    const out = text((await run('find law of bicycles', LOBBY)).lines)

    expect(out).toContain('there is always one bolt')
    // The address is the post's — a reply has none of its own (§4.3) — so the
    // marker is what keeps that from being a small lie.
    expect(out).toContain('builders/5')
    expect(out).toContain('(reply)')
  })

  it('refuses the names the database refuses', async () => {
    const { run } = harness()
    for (const slug of ['terms', 'privacy', 'lobby', 'api']) {
      const out = text((await run(`make ${slug} something`, LOBBY)).lines)
      expect(out, slug).toContain('spoken for')
    }

    // And a person's name, which the lobby would otherwise show as theirs.
    const person = text((await run('make marisol a room wearing her name', LOBBY)).lines)
    expect(person).toContain("somebody's name")
    expect(person).toContain('go ~marisol')
  })

  it('never lets commons into a search, in either Env', async () => {
    const { run } = harness()
    const out = text((await run('find --limit=100 super keeps saying', LOBBY)).lines)
    expect(out).toMatch(/nothing said about/)
  })

  it('says a quiet room is quiet, rather than claiming everything is in the lobby', async () => {
    const { run, rooms } = harness()
    await run('make garden what you are growing', LOBBY)

    const made = rooms.find((room) => room.slug === 'garden')!
    // A fortnight of silence is the same interval the lobby query uses.
    made.posts = []
    ;(made as { createdAt?: Date }).createdAt = undefined

    const out = text((await run('find --rooms garden', LOBBY)).lines)
    expect(out).toContain('nothing in it yet')
  })
})
