import { describe, expect, it } from 'vitest'
import { openingHint, startArrivalReads } from '@/lib/shell/boot'
import { fixtureEnv, type Env } from '@/lib/shell/env'
import type { Location } from '@/lib/shell/types'

/**
 * Boot's requests overlap, and nothing else in the suite can tell.
 *
 * This is a timing property, which is a category the rest of the tests here do
 * not cover at all: every one of them awaits a result and checks what it says.
 * Boot ran its reads nose to tail — session, profile, room list, room, mail
 * count — and going back to that would break no test and change no output. The
 * screen would only be slower, and on a free-tier database a continent away
 * "only slower" is a prompt in three seconds instead of half of one.
 *
 * So what is asserted is how many requests are in flight at once. A version
 * that awaits one before starting the next never gets above one, whatever it
 * returns.
 */

/** An Env that answers slowly and records how many calls overlapped. */
function watched(): { env: Env; peak: () => number; order: string[] } {
  const base = fixtureEnv()
  let live = 0
  let peak = 0
  const order: string[] = []

  // Long enough that a serial implementation cannot accidentally overlap, short
  // enough that the suite does not notice.
  const slow = async <T>(name: string, value: () => Promise<T>): Promise<T> => {
    order.push(name)
    live += 1
    peak = Math.max(peak, live)
    try {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return await value()
    } finally {
      live -= 1
    }
  }

  const env: Env = {
    ...base,
    listRooms: () => slow('listRooms', () => base.listRooms()),
    getRoom: (slug) => slow('getRoom', () => base.getRoom(slug)),
    mailCount: () => slow('mailCount', () => base.mailCount()),
  }
  return { env, peak: () => peak, order }
}

describe('arriving somewhere asks for everything at once', () => {
  it('has the room list and the room in flight together', async () => {
    const { env, peak } = watched()

    const reads = startArrivalReads(env, { room: 'music' } as Location)
    await Promise.all([reads.rooms, reads.room])

    // Two, not one. One means somebody put an await back.
    expect(peak()).toBe(2)
  })

  it('starts them before anything is awaited', async () => {
    /*
     * The distinction that makes this work at all: a promise runs when it is
     * made, not when it is awaited. `startArrivalReads` returns promises rather
     * than values precisely so the caller can go and check the session while
     * these are in the air.
     *
     * Asserted by never awaiting — both calls have to have happened by the time
     * the function has returned.
     */
    const { env, order } = watched()
    startArrivalReads(env, { room: 'music' } as Location)

    expect(order).toContain('listRooms')
    expect(order).toContain('getRoom')
  })

  /*
   * There was a third test here that timed the pair with `Date.now()` and
   * required under 18ms for two 10ms sleeps. It measured nothing the two above
   * do not: taking one request's worth of time is the *consequence* of the
   * overlap `peak()` already proves, and there is no way to be serial with a
   * peak of two.
   *
   * What it did add was a coin flip. On a loaded machine — the suite running
   * beside a build, which is exactly how `npm test && npm run build` behaves —
   * it failed about one run in five, measured. A test that fails for reasons
   * unrelated to the code is worse than no test at all: it teaches everybody to
   * re-run rather than look, and the next real failure gets the same shrug.
   */
})

describe('what it does not fetch', () => {
  it('asks for no room in the lobby, where there is none to ask for', async () => {
    const { env, order } = watched()
    const reads = startArrivalReads(env, {} as Location)

    expect(reads.room).toBeUndefined()
    expect(order).not.toContain('getRoom')
    await reads.rooms
  })

  it('asks for no room on a profile', async () => {
    // `~marisol` is a person, resolved by `getProfile`. Prefetching a *room* of
    // that name would be a wasted request on every profile anybody opens.
    const { env, order } = watched()
    const reads = startArrivalReads(env, { person: 'marisol' } as Location)

    expect(reads.room).toBeUndefined()
    expect(order).not.toContain('getRoom')
    await reads.rooms
  })

  it('asks for no room on the feed', async () => {
    /*
     * The feed is a room that holds nothing of its own — `readFeed` is what
     * fills it. Prefetching it would fetch an empty room and throw it away, and
     * worse, would look like it worked.
     */
    const { env, order } = watched()
    const reads = startArrivalReads(env, { room: 'feed' } as Location)

    expect(reads.room).toBeUndefined()
    expect(order).not.toContain('getRoom')
    await reads.rooms
  })
})

describe('a failure while nobody is awaiting yet', () => {
  it('does not go unhandled between being started and being read', async () => {
    /*
     * There is a session lookup between `startArrivalReads` and the await, and
     * that is long enough for a rejected promise with no handler to be reported
     * by the browser as an uncaught error — on the one path where the site
     * catches everything and says something useful about it. A `.catch` is
     * attached at creation for that reason, and this is the test that it is.
     */
    const base = fixtureEnv()
    const env: Env = {
      ...base,
      async getRoom() {
        throw new Error('the database is down')
      },
    }

    const seen: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent) => seen.push(event.reason)
    process.on('unhandledRejection', onUnhandled)

    const reads = startArrivalReads(env, { room: 'music' } as Location)
    await reads.rooms
    // Two turns of the microtask queue plus a macrotask, which is where node
    // decides a rejection is unhandled.
    await new Promise((resolve) => setTimeout(resolve, 20))
    process.off('unhandledRejection', onUnhandled)

    expect(seen).toEqual([])

    // And the failure is still there to be found by whoever awaits it, rather
    // than swallowed — the boot error path is what turns this into a sentence.
    await expect(reads.room).rejects.toThrow('the database is down')
  })
})

/**
 * The one line of instruction on the first screen.
 *
 * Found by walking the demo as somebody arriving for the first time: the line
 * said `look`, and `look` printed the three items already visible above it. The
 * first command a newcomer runs should show them something.
 */
describe('the line that tells a newcomer what to type', () => {
  it('does not send anybody to look, which is already on the screen', () => {
    for (const where of [{}, { room: 'commons' }, { room: 'music', postId: 12 }, { person: 'marisol' }]) {
      expect(openingHint(where as Location)).not.toContain('look')
    }
  })

  it('names a room to walk into when the list is what you are looking at', () => {
    expect(openingHint({} as Location)).toContain('go')
    expect(openingHint({} as Location)).not.toContain('rooms')
  })

  it('names the rooms when a room is what you are looking at', () => {
    expect(openingHint({ room: 'commons' } as Location)).toContain('rooms')
    expect(openingHint({ room: 'music' } as Location)).toContain('rooms')
  })

  it('and from a post or a wall, which are places you arrive at by link', () => {
    expect(openingHint({ room: 'music', postId: 12 } as Location)).toContain('rooms')
    expect(openingHint({ person: 'marisol' } as Location)).toContain('rooms')
  })

  it('names no particular room, because an example gets copied exactly', () => {
    // A room called `onions` glossed "what you are growing" is how this was
    // learned the first time.
    expect(openingHint({} as Location)).toContain('a name from the list')
  })
})
