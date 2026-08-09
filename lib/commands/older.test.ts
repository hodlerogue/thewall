import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRunner } from '@/lib/commands/run'
import { findCommand } from '@/lib/commands/registry'
import { ROOM_PAGE, fixtureEnv, type Env } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Post, Room } from '@/lib/shell/model'
import type { Line, Location } from '@/lib/shell/types'
import { ROOMS as FIXTURE_ROOMS } from '@/lib/shell/fixtures'

/**
 * Reading a room to the end.
 *
 * "What happens if you go into a room with hundreds or thousands of posts?"
 * You saw the newest page, nothing said so, and the only way to anything older
 * was `go 5` for a number you had no way to learn. /about's claim — "it cannot
 * scroll forever. A room holds what people said in it, and when you have read
 * it you have read it" — was false in every busy room.
 *
 * No test could see it, either: `fixtureEnv.getRoom` returned every post a room
 * had while `supabaseEnv` capped it, so truncation did not exist in any suite.
 * That divergence is asserted here first, because it is the reason the rest of
 * this went unnoticed.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')
const AT: Location = { room: 'big' }

/** A room with `count` posts, newest last in the array, addresses 1..count. */
function bigRoom(count: number, slug = 'big', ephemeral = false): Room {
  const posts: Post[] = Array.from({ length: count }, (_, i) => ({
    id: count - i,
    author: 'marisol',
    body: `post number ${count - i}`,
    createdAt: new Date(Date.now() - i * 60_000),
    replies: [],
  }))
  return { slug, gloss: 'a lot of talking', ephemeral, posts }
}

function harness(rooms: Room[]) {
  const env: Env = fixtureEnv(rooms)
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
    async reply() {
      return 1
    },
    async rename(name) {
      return { ok: true as const, name }
    },
  }
  const session = new Session(api, writer, 'ryan')
  return { env, session, run: createRunner(env, ['commons'], session) }
}

describe('the fixture and the database agree about how much a room gives you', () => {
  it('hands back one page, not the whole room', async () => {
    const { env } = harness([bigRoom(500)])
    const room = await env.getRoom('big')
    expect(room?.posts.length).toBe(ROOM_PAGE)
  })

  it('says there is more, without being asked twice', async () => {
    const { env } = harness([bigRoom(500)])
    expect((await env.getRoom('big'))?.more).toBe(true)
  })

  it('does not claim more when a room is exactly one page', async () => {
    /*
     * The trap in the obvious implementation. `posts.length === ROOM_PAGE` is
     * the same answer for "exactly a page" and "nine hundred more", so a room
     * with precisely a page in it would be offered an `older` that finds
     * nothing. Both Envs fetch one extra and report whether it arrived.
     */
    const { env } = harness([bigRoom(ROOM_PAGE)])
    const room = await env.getRoom('big')
    expect(room?.posts.length).toBe(ROOM_PAGE)
    expect(room?.more).toBeFalsy()
  })

  it('gives the newest page, not the oldest', async () => {
    const { env } = harness([bigRoom(500)])
    const room = await env.getRoom('big')
    // Addresses 500 down to 441 — the query is newest-first; the renderer is
    // the only thing that reverses it.
    expect(room!.posts[0].id).toBe(500)
    expect(room!.posts[room!.posts.length - 1].id).toBe(500 - ROOM_PAGE + 1)
  })
})

describe('a room says when you are seeing a slice of it', () => {
  it('offers older when there is more', async () => {
    const { run } = harness([bigRoom(500)])
    expect(text((await run('look', AT)).lines)).toContain('older')
  })

  it('stays quiet when the room fits', async () => {
    const { run } = harness([bigRoom(4)])
    expect(text((await run('look', AT)).lines)).not.toContain('older —')
  })

  it('puts the notice above the posts, where the cut actually is', async () => {
    // The listing runs oldest-first, so everything missing is older than the
    // first post shown — the boundary is at the top, like mail's cap notice.
    const { run } = harness([bigRoom(500)])
    const lines = (await run('look', AT)).lines
    const notice = lines.findIndex((l) => l.text.includes('older'))
    const firstPost = lines.findIndex((l) => l.text.includes('post number'))

    expect(notice).toBeGreaterThanOrEqual(0)
    expect(notice).toBeLessThan(firstPost)
  })
})

describe('older walks back a page at a time', () => {
  it('gives the page before the one you are looking at', async () => {
    const { run } = harness([bigRoom(500)])
    await run('look', AT)
    const out = text((await run('older', AT)).lines)

    // First page was 500..441, so this is 440..381.
    expect(out).toContain('post number 440')
    expect(out).toContain('post number 381')
    expect(out).not.toContain('post number 441')
  })

  it('works straight after arriving, with nothing remembered yet', async () => {
    // Six places render a room and none of them tell the session what they
    // printed, so `older` has to be able to find its own starting point.
    const { run } = harness([bigRoom(500)])
    const out = text((await run('older', AT)).lines)
    expect(out).toContain('post number 440')
  })

  it('keeps going, rather than repeating the same page', async () => {
    const { run } = harness([bigRoom(500)])
    await run('older', AT)
    const second = text((await run('older', AT)).lines)

    expect(second).toContain('post number 380')
    expect(second).not.toContain('post number 440')
  })

  it('reaches the start and says so', async () => {
    const { run } = harness([bigRoom(70)])
    const out = text((await run('older', AT)).lines)

    expect(out).toContain('post number 1')
    expect(out).toContain('that’s the start of the room.')
  })

  it('says there is nothing before the start, rather than printing an empty page', async () => {
    const { run } = harness([bigRoom(4)])
    const out = text((await run('older', AT)).lines)
    expect(out).toContain('nothing before it')
  })

  it('runs time the same way the room does, oldest at the top', async () => {
    const { run } = harness([bigRoom(500)])
    const lines = (await run('older', AT)).lines
    const oldest = lines.findIndex((l) => l.text.includes('post number 381'))
    const newest = lines.findIndex((l) => l.text.includes('post number 440'))

    expect(oldest).toBeGreaterThanOrEqual(0)
    expect(oldest).toBeLessThan(newest)
  })

  it('starts over once you have walked somewhere and back', async () => {
    const { run } = harness([bigRoom(500), bigRoom(500, 'other')])
    await run('older', AT)
    await run('older', AT)
    await run('go other', AT)
    await run('go big', { room: 'other' })

    // `go` reset it, so this is the first page back again rather than page four.
    expect(text((await run('older', AT)).lines)).toContain('post number 440')
  })

  it('and look resets it too, since look prints the newest page', async () => {
    const { run } = harness([bigRoom(500)])
    await run('older', AT)
    await run('older', AT)
    await run('look', AT)
    expect(text((await run('older', AT)).lines)).toContain('post number 440')
  })

  it('shows no addresses in commons, because commons has none', async () => {
    // §3.10 — the ephemeral branch is in the shared renderer, so `older` cannot
    // drift from the listing it prints underneath.
    const { run } = harness([bigRoom(500, 'commons', true)])
    const out = text((await run('older', { room: 'commons' })).lines)
    expect(out).toContain('post number 440')
    expect(out).not.toMatch(/^440\s/m)
  })

  it('is offered by the room itself, which is where it is useful', async () => {
    /*
     * This asserted a row in `help`, and `older` was folded out of that list
     * when `write` earned one — §3.6 caps the first group at ten lines, so a
     * new row means choosing one to drop.
     *
     * `older` is the right one to drop and this is why: a room with more than a
     * page in it prints the offer at the top of its own listing, every time it
     * is looked at. A permanent row for a paging control is the redundancy;
     * the offer where the cut actually is, is not.
     */
    const { run } = harness([bigRoom(500)])
    expect(text((await run('look', AT)).lines)).toContain('older — the page before this one')
  })

  it('is still explained by what, and still on the palette', async () => {
    const { run } = harness([bigRoom(500)])
    expect(text((await run('what older', AT)).lines)).toContain('older')
    expect(findCommand('older')?.hidden).toBeFalsy()
  })

  it('is refused from the lobby, naming a room to try it in', async () => {
    const { run } = harness([bigRoom(500)])
    const out = text((await run('older', {})).lines)
    expect(out).toMatch(/nothing to walk back through/)
  })
})

describe('the claim on the about page is true again', () => {
  it('a room can be read from the newest post to the first one', async () => {
    /*
     * /about: "it cannot scroll forever. A room holds what people said in it,
     * and when you have read it you have read it." That is the sentence this
     * verb exists to make true, so it is checked end to end rather than a page
     * at a time — walk back until the room says stop, and account for every
     * post on the way.
     */
    const total = 250
    const { run } = harness([bigRoom(total)])
    const seen = new Set<number>()

    for (const line of (await run('look', AT)).lines) {
      const match = /post number (\d+)/.exec(line.text)
      if (match) seen.add(Number(match[1]))
    }

    for (let step = 0; step < 20; step += 1) {
      const lines = (await run('older', AT)).lines
      const out = text(lines)
      for (const line of lines) {
        const match = /post number (\d+)/.exec(line.text)
        if (match) seen.add(Number(match[1]))
      }
      if (out.includes('start of the room')) break
    }

    expect(seen.size).toBe(total)
    expect(Math.min(...seen)).toBe(1)
    expect(Math.max(...seen)).toBe(total)
  })
})

describe('typing does not re-render the scrollback', () => {
  /*
   * Why this is a source test and not a timing one: the cost is real but small
   * — measured at about 0.007ms per line per keystroke — so an assertion on the
   * clock is a flaky assertion. What matters is structural, and it is what the
   * page size depends on: `input` is state on `Terminal`, so anything rendered
   * inline in `Terminal` is rebuilt on every letter typed. At the old 600-line
   * cap that was a few milliseconds a keystroke on a desktop and several times
   * that on a phone, and it is the reason a room could only show 30 posts.
   */
  const source = readFileSync(join(__dirname, '..', '..', 'components', 'Terminal.tsx'), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  it('is reading the file it thinks it is', () => {
    expect(code).toContain('MAX_LINES')
    expect(code).toContain('visualViewport')
  })

  it('renders the lines through a memo, not inline', () => {
    expect(code).toMatch(/const Scrollback = memo\(/)
    expect(code).toContain('<Scrollback lines={lines} onInsert={insert} />')
  })

  it('hands the memo a callback that does not change on every letter', () => {
    /*
     * `memo` compares props, so an inline arrow or a `useCallback` that closes
     * over `input` would defeat it completely — every keystroke would make a
     * new function, the comparison would fail, and the whole scrollback would
     * re-render exactly as it did before the memo existed. That is invisible:
     * nothing breaks, the page size decision above just quietly stops being
     * paid for.
     *
     * `insert` sets input rather than reading it, so it needs no dependencies.
     */
    expect(code).toMatch(/const insert = useCallback\([\s\S]*?\}, \[\]\)/)
  })

  it('keeps enough scrollback for older to be worth having', () => {
    // A page is roughly 200 lines. At the old 600 the first `older` would trim
    // away the page you started on, so walking back lost what you had read.
    const cap = Number(/const MAX_LINES = (\d+)/.exec(code)?.[1])
    expect(cap).toBeGreaterThanOrEqual(ROOM_PAGE * 3 * 3)
  })
})

describe('the fixtures obey the rule the allocator enforces', () => {
  /*
   * `create_post` hands out addresses in order and never reuses one (§3.4), so
   * in any real room a higher number is a newer post. Nothing checked that of
   * the fixtures, and commons had it exactly backwards — id 1 was the newest —
   * which is invisible until something pages by address, and then `older`
   * walks *forwards* in time in that one room.
   *
   * Asserted over every fixture room rather than the one that was wrong,
   * because the next one added will be written by hand too.
   */
  it('never has a lower address on a newer post', () => {
    for (const room of FIXTURE_ROOMS) {
      const sorted = [...room.posts].sort((a, b) => a.id - b.id)
      for (let i = 1; i < sorted.length; i += 1) {
        expect(
          sorted[i].createdAt.getTime(),
          `${room.slug}: post ${sorted[i].id} is older than ${sorted[i - 1].id}`,
        ).toBeGreaterThanOrEqual(sorted[i - 1].createdAt.getTime())
      }
    }
  })

  it('lists them newest first, the way every query returns them', () => {
    for (const room of FIXTURE_ROOMS) {
      for (let i = 1; i < room.posts.length; i += 1) {
        expect(
          room.posts[i].createdAt.getTime(),
          `${room.slug}: post at index ${i} is newer than the one before it`,
        ).toBeLessThanOrEqual(room.posts[i - 1].createdAt.getTime())
      }
    }
  })
})

describe('the demo lobby is the same building as the real one', () => {
  /*
   * The fixture Env lists rooms in array order; the database lists them by
   * `sort_order`. Nothing tied the two together, so adding crypto and movies
   * put them after `feed` in the demo and before it on the site — the same
   * lobby, in two different orders, which is precisely what §3.11's "the
   * building has to look the same each time" is about.
   *
   * Read out of `seed.sql` rather than written down here, so there is one
   * answer to "what order is the lobby in" instead of two that agree today.
   */
  const seed = readFileSync(join(__dirname, '..', '..', 'supabase', 'seed.sql'), 'utf8')

  /** `('commons', 0), ('music', 1), …` from the seed's ordering block. */
  function seedOrder(): string[] {
    const block = /update public\.rooms set sort_order = v\.sort_order[\s\S]*?as v \(slug, sort_order\)/.exec(seed)
    const pairs = [...(block?.[0] ?? '').matchAll(/\('([a-z]+)',\s*(\d+)\)/g)]
    return pairs.sort((a, b) => Number(a[2]) - Number(b[2])).map((m) => m[1])
  }

  it('found the ordering block, so this is comparing against something', () => {
    expect(seedOrder().length).toBeGreaterThan(5)
    expect(seedOrder()[0]).toBe('commons')
  })

  it('lists the lobby in the order the seed sets', () => {
    // Walls are excluded on both sides: they are rooms, and never in the lobby.
    const fixtures = FIXTURE_ROOMS.filter((room) => room.owner === undefined).map((r) => r.slug)
    expect(fixtures).toEqual(seedOrder())
  })

  it('has every room the seed does, and no others', () => {
    const fixtures = new Set(FIXTURE_ROOMS.filter((r) => r.owner === undefined).map((r) => r.slug))
    expect([...fixtures].sort()).toEqual([...seedOrder()].sort())
  })
})
