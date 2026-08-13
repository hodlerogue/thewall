import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv, type Env } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Room } from '@/lib/shell/model'
import type { Line, Location } from '@/lib/shell/types'

/**
 * Rooms that grew out of a room.
 *
 * "Can you create a room within a room? Maybe 3-5 deep, for subtopics." The
 * answer built here is flat-and-linked rather than nested: a room made while
 * standing in `music` is an ordinary room with an ordinary address, and the
 * only thing connecting them is a line at the bottom of music. Nothing is
 * inside anything. See `20260806020000_rooms_grew_out_of.sql` for why — an
 * address that grows a segment every level stops being typable, and a tree of
 * near-empty rooms is §5's "an empty room is worse than no room" five times
 * over.
 *
 * So the property under test is narrow and everywhere: **where you were
 * standing gets recorded, and the parent lists what left it.** Everything else
 * — permissions, addressing, the lobby — is unchanged by design, and the tests
 * that would notice otherwise are the ones asserting it stays a label.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')

function room(slug: string, extra: Partial<Room> = {}): Room {
  return { slug, gloss: `talking about ${slug}`, ephemeral: false, posts: [], ...extra }
}

function harness(rooms: Room[], name: string | null = 'ryan') {
  const env: Env = fixtureEnv(rooms)
  const api: SignupApi = {
    async checkName() {
      return { available: true, alternates: [] }
    },
    async create(n) {
      return { ok: true as const, name: n }
    },
    async logout() {
      return { ok: true as const }
    },
    async login(n) {
      return { ok: true as const, name: n, note: 'sent' }
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
    async rename(n) {
      return { ok: true as const, name: n }
    },
  }
  const session = new Session(api, writer, name)
  return { env, session, run: createRunner(env, ['commons'], session) }
}

const seed = () => [room('music'), room('poker'), room('~marisol', { owner: 'marisol' })]

describe('a room remembers where it was made', () => {
  it('records the room you were standing in', async () => {
    const { env, run } = harness(seed())
    await run('make bebop the fast stuff', { room: 'music' } as Location)
    expect((await env.getRoom('bebop'))?.fromRoom).toBe('music')
  })

  it('records the room, when you were reading a post inside it', async () => {
    /*
     * The commonest moment to want a room for a tangent is halfway down
     * somebody's thread, so `make` from `music/12` has to mean "from music" and
     * not "from nowhere". `location.room` is still music inside a post — the
     * post is the `post` field — so this is asserting the handler reads the
     * right one rather than deriving a parent from the address.
     */
    const { env, run } = harness([room('music', { posts: [
      { id: 12, author: 'marisol', body: 'have you heard this', createdAt: new Date(), replies: [] },
    ] })])
    await run('make bebop the fast stuff', { room: 'music', post: 12 } as Location)
    expect((await env.getRoom('bebop'))?.fromRoom).toBe('music')
  })

  it('records nothing when you were in the lobby', async () => {
    const { env, run } = harness(seed())
    await run('make bebop the fast stuff', {} as Location)
    expect((await env.getRoom('bebop'))?.fromRoom).toBeUndefined()
  })

  it('records nothing when you were on somebody’s wall', async () => {
    // "bebop grew out of ~marisol" is not a thing anybody means, and a wall is
    // one person's, so it would also be the one place lineage read as ownership.
    const { env, run } = harness(seed())
    await run('make bebop the fast stuff', { room: '~marisol' } as Location)
    expect((await env.getRoom('bebop'))?.fromRoom).toBeUndefined()
  })

  it('records nothing when you were on the feed', async () => {
    const { env, run } = harness([...seed(), room('feed')])
    await run('make bebop the fast stuff', { room: 'feed' } as Location)
    expect((await env.getRoom('bebop'))?.fromRoom).toBeUndefined()
  })
})

describe('and says so, in the room it just opened', () => {
  /*
   * Reported as a worry that a room made inside a room "will only show up from
   * within that specific room", with a request to have to confirm first. The
   * fact is the opposite — the room is ordinary and the parent link only adds
   * a line to the parent — but the belief was earned: this printed exactly what
   * it prints in the lobby, so the one difference was invisible from inside the
   * room that had just been made.
   */
  it('names the room it grew out of', async () => {
    const { run } = harness([room('music')])
    const out = text((await run('make bebop the fast stuff', { room: 'music' } as Location)).lines)

    expect(out).toContain('it grew out of music')
    // And the correction to the thing somebody feared, in the same breath.
    expect(out).toMatch(/ordinary room either way/)
    expect(out).toMatch(/in the lobby/)
  })

  it('says how to have it otherwise, which is the only actionable part', async () => {
    const { run } = harness([room('music')])
    const out = text((await run('make bebop the fast stuff', { room: 'music' } as Location)).lines)
    expect(out).toMatch(/make it from the lobby/)
  })

  it('says none of it when there is no parent to name', async () => {
    // From the lobby nothing grew out of anything, and a line explaining that
    // would be a paragraph about a thing that did not happen.
    const { run } = harness(seed())
    const out = text((await run('make bebop the fast stuff', {} as Location)).lines)

    expect(out).not.toContain('grew out of')
    expect(out).not.toMatch(/from the lobby/)
  })

  it('says it for a room made from inside a post, naming the room', async () => {
    const { run } = harness([room('music', { posts: [
      { id: 12, author: 'marisol', body: 'have you heard this', createdAt: new Date(), replies: [] },
    ] })])
    const out = text((await run('make bebop the fast stuff', { room: 'music', post: 12 } as Location)).lines)
    expect(out).toContain('it grew out of music')
  })
})

describe('the parent room says what grew out of it', () => {
  it('lists it, at the bottom, after the posts', async () => {
    const { run } = harness([room('music', { posts: [
      { id: 1, author: 'marisol', body: 'first', createdAt: new Date(), replies: [] },
    ] })])
    await run('make bebop the fast stuff', { room: 'music' } as Location)

    const out = text((await run('go music', {} as Location)).lines)
    expect(out).toContain('a room that grew out of here')
    // A room name and a word about it, the way the lobby lists a room — and the
    // name in accent, because that is the colour this interface uses for a
    // thing you can type. It was dim, on one line, and read as prose.
    expect(out).toContain('bebop')
    expect(out).toContain('the fast stuff')
    // Navigation, not content: below the last post, which is where the eye
    // lands after `Terminal` scrolls to the end.
    expect(out.indexOf('first')).toBeLessThan(out.indexOf('bebop'))
  })

  it('lists it in a room that has nothing in it', async () => {
    /*
     * The case that matters most, and the one the first version of the renderer
     * got wrong: an empty room returned early with "nothing here yet", so the
     * subtopics of the room people had walked *out of* were invisible. A room
     * with no posts and three children is exactly the room whose children are
     * the only useful thing on the screen.
     */
    const { run } = harness([room('music')])
    await run('make bebop the fast stuff', { room: 'music' } as Location)

    const out = text((await run('go music', {} as Location)).lines)
    expect(out).toContain('nothing here yet')
    expect(out).toContain('bebop')
    expect(out).toContain('the fast stuff')
  })

  it('says how many it is not showing', async () => {
    // No silent caps, here as in the lobby and in `mail`. A room that spawned
    // forty is not listing forty on a 380px screen, and the ones cut are still
    // reachable by name.
    const rooms = [room('music')]
    const { run } = harness(rooms)
    for (let i = 0; i < 11; i++) {
      await run(`make sub-${i} subtopic number ${i}`, { room: 'music' } as Location)
    }
    const out = text((await run('go music', {} as Location)).lines)
    expect(out).toContain('and 3 more')
    expect(out).toContain('find --rooms')
  })

  it('prints the name in the colour a room name always has', async () => {
    /*
     * Reported as "that room should be showing in orange to depict a room but
     * it's just normal text." Orange is not decoration here — it is what this
     * interface uses for a thing you can type, which is exactly what this line
     * is for. It was `dim`, the skim-past colour.
     */
    const { run } = harness([room('music')])
    await run('make bebop the fast stuff', { room: 'music' } as Location)

    const lines = (await run('go music', {} as Location)).lines
    const name = lines.find((l) => l.text === 'bebop')
    expect(name, 'the room name is not on a line of its own').toBeDefined()
    expect(name!.tone).toBe('accent')
  })

  it('says nothing at all when nothing grew out of it', async () => {
    const { run } = harness([room('music')])
    const out = text((await run('go music', {} as Location)).lines)
    expect(out).not.toContain('grew out of')
  })
})

describe('lineage is a label and never a permission or an address', () => {
  it('gives the new room a plain top-level address', async () => {
    const { run } = harness(seed())
    const made = await run('make bebop the fast stuff', { room: 'music' } as Location)
    expect(made.location).toEqual({ room: 'bebop' })

    // Reachable by its own name from anywhere, with no path through the parent.
    const out = text((await run('go bebop', {} as Location)).lines)
    expect(out).not.toContain('music/bebop')
  })

  it('lets anybody make a room from inside a room they did not make', async () => {
    // There is no moderator here and lineage does not invent one. The person
    // who opened `music` has exactly the powers everybody else in it has.
    const { env, run } = harness([room('music', { madeBy: 'marisol' })])
    const made = await run('make bebop the fast stuff', { room: 'music' } as Location)
    expect(made.lines.some((l) => l.text.includes('bebop is open'))).toBe(true)
    expect((await env.getRoom('bebop'))?.fromRoom).toBe('music')
  })

  it('does not put a room in the lobby twice for having a parent', async () => {
    const { run } = harness([room('music')])
    await run('make bebop the fast stuff', { room: 'music' } as Location)
    const out = text((await run('look', {} as Location)).lines)
    expect(out.split('\n').filter((line) => line === 'bebop')).toHaveLength(1)
  })
})

describe('the fixture refuses the same parents the database does', () => {
  it('drops a parent that is not a room', async () => {
    const { env } = harness([room('music')])
    const made = await env.makeRoom('bebop', 'the fast stuff', 'nowhere')
    expect(made.ok).toBe(true)
    expect((await env.getRoom('bebop'))?.fromRoom).toBeUndefined()
  })

  it('drops a room claiming itself as its own parent', async () => {
    const { env } = harness([room('music')])
    await env.makeRoom('bebop', 'the fast stuff', 'bebop')
    expect((await env.getRoom('bebop'))?.fromRoom).toBeUndefined()
  })

  it('drops a wall', async () => {
    const { env } = harness(seed())
    await env.makeRoom('bebop', 'the fast stuff', '~marisol')
    expect((await env.getRoom('bebop'))?.fromRoom).toBeUndefined()
  })

  it('makes the room anyway, every time', async () => {
    // A bad parent is not a refusal. Losing the sentence somebody typed over a
    // label they did not ask for would be the worst trade in the codebase.
    const { env } = harness([room('music')])
    const parents = ['nowhere', 'bebop', '~marisol', '']
    for (const [i, parent] of parents.entries()) {
      // The slug is generated rather than derived from the parent: `r-~marisol`
      // is a refusal about the *name*, which would have passed this test for
      // entirely the wrong reason.
      const made = await env.makeRoom(`room-${i}`, 'a room', parent)
      expect(made.ok, `parent ${JSON.stringify(parent)}`).toBe(true)
      expect((await env.getRoom(`room-${i}`))?.fromRoom).toBeUndefined()
    }
  })
})

describe('you can find it under the word you already have in mind', () => {
  it('names make in the help list', async () => {
    const { run } = harness([room('music')])
    expect(text((await run('help', {} as Location)).lines)).toContain('make —')
  })

  it('and the word create is on that line too', async () => {
    /*
     * Reported as "create doesn't appear to be showing in the help menu". It
     * was there as `make — start a new room`: right verb, wrong word to scan
     * for. Asserting the *word* rather than the alias table, because the alias
     * table was already correct when this was reported.
     */
    const { run } = harness([room('music')])
    const line = text((await run('help', {} as Location)).lines)
      .split('\n')
      .find((l) => l.startsWith('make —'))
    expect(line).toContain('create')
  })

  it('runs when typed by either name', async () => {
    const { env, run } = harness([room('music')])
    await run('create bebop the fast stuff', { room: 'music' } as Location)
    expect((await env.getRoom('bebop'))?.fromRoom).toBe('music')
  })

  it('explains the lineage in what make, since it is the surprising half', async () => {
    const { run } = harness([room('music')])
    expect(text((await run('what make', {} as Location)).lines)).toContain('grown out of')
  })
})
