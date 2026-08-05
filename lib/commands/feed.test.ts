import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { renderFeed, renderRoomList } from '@/lib/shell/render'
import { fixtureEnv } from '@/lib/shell/env'
import { ROOMS } from '@/lib/shell/fixtures'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'

/**
 * feed — every wall in one place.
 *
 * Walls are kept out of the lobby, because §4.2's "forty rooms with three
 * people each kills the entire feeling" is exactly what a door per person does
 * to a room list. That mitigation worked and left a hole: a wall is only ever
 * found by already knowing whose it is, so anything said on one reaches the
 * people who thought to go and look.
 *
 * So the property under test is that feed closes the hole without reopening
 * what §4.2 warned about — one room in the lobby, and the walls still out of it.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')

function harness(me: string | null = 'jameson') {
  const posted: { room: string; body: string }[] = []
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
    async post(room, body) {
      posted.push({ room, body })
      return 7
    },
    async reply() {},
    async rename(name: string) {
      return { ok: true as const, name }
    },
  }
  const rooms = ROOMS.map((room) => ({ ...room, posts: [...room.posts] }))
  return {
    run: createRunner(fixtureEnv(rooms), ['commons'], new Session(api, writer, me)),
    posted,
  }
}

const LOBBY: Location = {}
const FEED: Location = { room: 'feed' }

describe('the feed', () => {
  it('is in the lobby, so walls do not have to be', async () => {
    const { run } = harness()
    const lobby = text((await run('look', LOBBY)).lines)

    expect(lobby).toContain('feed')
    // And the walls themselves still are not — that is the whole arrangement.
    expect(lobby).not.toContain('~')
  })

  it('shows what people put on their walls, whoever they are', async () => {
    const { run } = harness()
    const out = text((await run('go feed', FEED)).lines)

    expect(out).toContain('neighbours own fans')
    expect(out).toContain('marisol')
  })

  it('gives every line the whole address, because a bare number is ambiguous', async () => {
    /*
     * Post numbers are allocated per room, so `2` on the feed is a different
     * post on every wall. A room listing puts a bare number in front of each
     * line; that would be a lie here.
     */
    const { run } = harness()
    const out = text((await run('look', FEED)).lines)

    expect(out).toMatch(/~marisol\/\d+/)
    expect(out).not.toMatch(/^\d+ {2}marisol/m)
  })

  it('walks to one, since the address it printed is the address go takes', async () => {
    const { run } = harness()
    const result = await run('go ~marisol/2', FEED)
    expect(result.location).toEqual({ room: '~marisol', postId: 2 })
  })

  it('says the number needs a name, rather than opening the wrong post', async () => {
    const { run } = harness()
    const out = text((await run('go 2', FEED)).lines)

    expect(out).toContain('needs the name')
    // And names one that is really there, rather than inventing an example.
    expect(out).toMatch(/go ~\w+\/\d+/)
  })

  it('puts what you say there on your own wall', async () => {
    // Refusing would be correct and useless: somebody reading everybody's walls
    // and typing a sentence means to add one, and theirs is the only wall they
    // can add to.
    const { run, posted } = harness('jameson')
    await run('say a thing for my own wall', FEED)

    expect(posted).toEqual([{ room: '~jameson', body: 'a thing for my own wall' }])
  })

  it('holds the sentence for somebody with no name, and lands it on the wall they get', async () => {
    /*
     * The address cannot be written down when the sentence is captured — there
     * is no name yet to make `~name` out of, and by the time there is, two
     * questions have been asked and the location is long gone. So the intent is
     * recorded and resolved at commit.
     */
    const { run, posted } = harness(null)
    await run('say my first thing', FEED)
    await run('newcomer', FEED)
    await run('newcomer@example.com', FEED)

    expect(posted).toEqual([{ room: '~newcomer', body: 'my first thing' }])
  })

  it('says what to do when nobody has a wall yet', async () => {
    const { run } = harness()
    const empty = createRunner(fixtureEnv([]), ['commons'], new Session(
      { async checkName() { return { available: true, alternates: [] } },
        async create(n) { return { ok: true as const, name: n } },
        async resend() { return { note: '' } } },
      { async post() { return 1 }, async reply() {}, async rename(n: string) { return { ok: true as const, name: n } } },
      'jameson',
    ))
    const out = text((await empty('look', FEED)).lines)

    expect(out).toContain('nothing on anybody’s wall yet')
    // §5 — an empty room says what would fill it, rather than just being empty.
    expect(out).toContain('go ~yourname')
    void run
  })

  it('tells you the replies are open to everybody', async () => {
    const { run } = harness()
    const out = text((await run('look', FEED)).lines)
    expect(out).toContain('anybody can answer any of these')
  })

  it('cannot be taken as a room name', async () => {
    const { run } = harness()
    const out = text((await run('make feed something else', LOBBY)).lines)
    expect(out).toContain('spoken for')
  })
})


describe('the feed is never rendered as an empty room', () => {
  /*
   * It is a room that holds nothing, so every surface that draws a room from
   * its posts draws it empty — "nothing here yet, say something and it will be
   * the first thing", which is wrong twice: it is not empty, and saying
   * something there does not go there.
   *
   * `go feed` was special-cased and three other surfaces were not, so the bug
   * lived on the URL somebody arrives at from a link, on the lobby line, and on
   * the share card. Each is asserted here rather than trusted.
   */
  it('has a lobby line, taken from the walls it shows', async () => {
    const { run } = harness()
    void run

    const rooms = await fixtureEnv().listRooms()
    const feed = rooms.find((room) => room.slug === 'feed')!

    expect(feed.latest, 'the feed line came back empty').toBeDefined()
    expect(feed.latest!.body).toContain('neighbours own fans')
  })

  it('never says "quiet in here" under itself', async () => {
    const lines = renderRoomList(await fixtureEnv().listRooms()).map((l) => l.text)
    const at = lines.indexOf('feed')
    expect(at, 'feed is not in the lobby').toBeGreaterThan(-1)
    expect(lines[at + 1]).not.toBe('quiet in here')
  })

  it('renders as a listing, not as a room with nothing in it', async () => {
    const out = renderFeed(await fixtureEnv().readFeed()).map((l) => l.text).join('\n')
    expect(out).not.toContain('nothing here yet')
    expect(out).toContain('~marisol/2')
  })

  it('says what would fill it only when it really is empty', () => {
    const out = renderFeed([]).map((l) => l.text).join('\n')
    expect(out).toContain('nothing on anybody’s wall yet')
    // And not the room version, which invites a post that would be refused.
    expect(out).not.toContain('say something and it will be the first thing')
  })

  it('is described by what it shows when searched for, not by its own count', async () => {
    const { run } = harness()
    const out = text((await run('find --rooms feed', LOBBY)).lines)

    expect(out).toContain('everything anybody has put on their own wall')
    expect(out).not.toContain('nothing in it yet')
  })
})

describe('what the feed tells you after you say something', () => {
  it('gives an address that works from where you are standing', async () => {
    /*
     * `go 7` only works inside the room the 7 belongs to. Saying something from
     * the feed puts it on your wall, and on the feed a bare number is refused
     * outright — so the confirmation was handing somebody an instruction that
     * fails when followed, which is the one thing §3.7 forbids.
     */
    const { run } = harness('jameson')
    const out = text((await run('say a thing for my own wall', FEED)).lines)

    expect(out).toContain('~jameson/7')
    expect(out).not.toMatch(/go 7 opens it/)
  })

  it('and that address really resolves', async () => {
    const { run } = harness('marisol')
    const result = await run('go ~marisol/2', FEED)
    expect(result.location).toEqual({ room: '~marisol', postId: 2 })
  })

  it('still says the bare number in a room, where the bare number is right', async () => {
    const { run } = harness('jameson')
    const out = text((await run('say found my dad’s records', { room: 'music' })).lines)
    expect(out).toMatch(/go 7 opens it/)
  })
})
