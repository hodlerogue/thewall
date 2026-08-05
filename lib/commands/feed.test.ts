import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
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
