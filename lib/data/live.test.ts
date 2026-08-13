import { describe, expect, it } from 'vitest'
import { arrivalLines } from '@/lib/data/live'
import type { Line } from '@/lib/shell/types'

/**
 * Your own words, coming back at you.
 *
 * Reported from real use:
 *
 *     ryan:music$ say idk about that
 *     music/20
 *
 *     20  ryan, just now
 *     idk about that
 *
 * The post arrived down the realtime channel and printed underneath the
 * confirmation, so everything said in a room appeared twice. The suppression
 * was there and could not work: the caller built the display string first —
 * `20  ryan` — and passed that as the author, so "is this mine" compared
 * `20  ryan` against `ryan`.
 *
 * Commons was the one place it behaved, because there the address is absent,
 * the prefix is empty, and the two strings were accidentally equal. That is
 * also why it survived: the only room anybody tests signup in is commons.
 */

const at = new Date().toISOString()

describe('what arrives live', () => {
  it('says nothing when the words are your own, in a room with addresses', () => {
    // The case that was broken. A room post carries a number, and the number
    // is what used to defeat the comparison.
    expect(arrivalLines({ author: 'ryan', mine: 'ryan', body: 'idk', at, depth: 0, address: 20 })).toEqual([])
  })

  it('and in commons, where there is no number', () => {
    expect(arrivalLines({ author: 'ryan', mine: 'ryan', body: 'idk', at, depth: 0 })).toEqual([])
  })

  it('and for a reply of yours in a post you are standing in', () => {
    expect(arrivalLines({ author: 'ryan', mine: 'ryan', body: 'idk', at, depth: 1 })).toEqual([])
  })

  it('prints somebody else’s post, with its address', () => {
    const lines = arrivalLines({ author: 'marisol', mine: 'ryan', body: 'warped ones still play', at, depth: 0, address: 20 })

    expect(lines).toHaveLength(2)
    expect(lines[0].text).toMatch(/^20 {2}marisol, /)
    expect(lines[1]).toEqual({ text: 'warped ones still play', depth: 1 })
  })

  it('prints somebody else’s commons post without one, because there is none', () => {
    const lines = arrivalLines({ author: 'marisol', mine: 'ryan', body: 'the AC is out', at, depth: 0 })
    expect(lines[0].text).toMatch(/^marisol, /)
    expect(lines[0].text).not.toMatch(/\d+ {2}marisol/)
  })

  it('indents a reply one step further than a post (§3.2)', () => {
    const lines = arrivalLines({ author: 'marisol', mine: 'ryan', body: 'yes', at, depth: 1 })
    expect(lines[0].depth).toBe(1)
    expect(lines[1].depth).toBe(2)
  })

  it('shows everything to a guest, who has no words of their own here', () => {
    const lines = arrivalLines({ author: 'marisol', mine: null, body: 'hello', at, depth: 0, address: 3 })
    expect(lines).toHaveLength(2)
  })

  it('matches on the whole name, not a piece of one', () => {
    // `ryan` and `ryanne` are two people, and neither should silence the other.
    expect(arrivalLines({ author: 'ryanne', mine: 'ryan', body: 'hi', at, depth: 0, address: 4 })).toHaveLength(2)
    expect(arrivalLines({ author: 'ryan', mine: 'ryanne', body: 'hi', at, depth: 0, address: 4 })).toHaveLength(2)
  })
})

/**
 * The channel itself, which until now had no test at all.
 *
 * Reported from a phone with the site installed to the home screen: a room open
 * in the app, a second browser saying something in it, and nothing appearing —
 * "i had to leave and go back in and then i saw it. it seems the messages
 * weren't updating on either side."
 *
 * Two separate holes, and the second is the one that matters. `postgres_changes`
 * is a live feed with **no replay**: when the system suspends a backgrounded
 * page the socket goes, and everything said during the gap is not queued
 * anywhere for later. So reconnecting is not enough on its own — it gets you
 * the next message and never the missed ones. Leaving the room and coming back
 * worked because that re-reads the room.
 *
 * The other hole: `subscribe`'s status callback returned without a word on
 * anything that was not `SUBSCRIBED`, so a channel that errored or timed out
 * stayed dead for as long as the room stayed open.
 */

class FakeChannel {
  handlers: ((payload: { new: Record<string, unknown> }) => Promise<void> | void)[] = []
  status: ((s: string) => Promise<void> | void) | null = null
  tracked = false
  removed = false
  /** What the real channel exposes, and what tells the two returns apart. */
  state: 'joined' | 'closed' = 'closed'

  on(_event: string, _filter: unknown, cb: (p: { new: Record<string, unknown> }) => Promise<void>) {
    this.handlers.push(cb)
    return this
  }
  subscribe(cb: (s: string) => Promise<void> | void) {
    this.status = cb
    return this
  }
  /** Joining, the way the socket does it: state first, then the callback. */
  async join(status = 'SUBSCRIBED') {
    this.state = status === 'SUBSCRIBED' ? 'joined' : 'closed'
    await this.status?.(status)
  }
  track() {
    this.tracked = true
    return Promise.resolve('ok')
  }
  presenceState() {
    return {}
  }
  async say(row: Record<string, unknown>) {
    for (const handler of this.handlers) await handler({ new: row })
  }
}

type Row = Record<string, string | number>

/** Just enough PostgREST to answer the four queries this module makes. */
function table(rows: Row[]) {
  let out = [...rows]
  const api = {
    select: () => api,
    eq: (col: string, value: unknown) => ((out = out.filter((r) => r[col] === value)), api),
    gt: (col: string, value: string) => ((out = out.filter((r) => String(r[col]) > value)), api),
    in: (col: string, values: unknown[]) =>
      ((out = out.filter((r) => values.includes(r[col]))), api),
    order: (col: string, { ascending }: { ascending: boolean }) => (
      (out = [...out].sort((a, b) =>
        a[col] === b[col] ? 0 : (a[col] < b[col] ? -1 : 1) * (ascending ? 1 : -1),
      )),
      api
    ),
    limit: (n: number) => ((out = out.slice(0, n)), api),
    maybeSingle: () => Promise.resolve({ data: out[0] ?? null, error: null }),
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
      Promise.resolve({ data: out, error: null }).then(resolve),
  }
  return api
}

function fakeClient(tables: Record<string, Row[]>) {
  const channels: FakeChannel[] = []
  const client = {
    from: (name: string) => table(tables[name] ?? []),
    channel: () => {
      const made = new FakeChannel()
      channels.push(made)
      return made
    },
    removeChannel: (c: FakeChannel) => {
      c.removed = true
      return Promise.resolve('ok')
    },
  }
  return { client: client as never, channels }
}

/** The app coming back to the screen, which is what a phone actually does. */
function returnToTheApp(state: 'visible' | 'hidden' = 'visible') {
  ;(globalThis as { document?: unknown }).document = {
    visibilityState: state,
    addEventListener: (_: string, cb: () => void) => listeners.push(cb),
    removeEventListener: () => {},
  }
}
const listeners: (() => void)[] = []

describe('a channel that stopped listening', () => {
  const room = 'kitchen'
  const older = '2026-08-13T10:00:00.000Z'
  const missed = '2026-08-13T10:05:00.000Z'

  const world = () => ({
    posts: [
      { id: 1, room_slug: room, post_no: 1, author_id: 'a', body: 'was here first', created_at: older },
    ] as Row[],
    profiles: [
      { id: 'a', name: 'marisol' },
      { id: 'b', name: 'ryan' },
    ] as Row[],
    replies: [] as Row[],
  })

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  /**
   * The app going away and coming back, as a phone does it.
   *
   * Suspending the page kills the socket, so the channel is closed by the time
   * anybody looks again — which is what makes this different from a tab switch
   * on a computer, where it usually is not.
   */
  const suspendAndReturn = async (channels: FakeChannel[]) => {
    channels[channels.length - 1].state = 'closed'
    listeners.forEach((wake) => wake())
    await flush()
    await channels[channels.length - 1].join()
    await flush()
  }

  it('prints what was said while the app was off the screen', async () => {
    listeners.length = 0
    returnToTheApp()
    const tables = world()
    const { client, channels } = fakeClient(tables)
    const printed: Line[] = []

    const { createLive } = await import('@/lib/data/live')
    createLive(client, [])
      .subscribe({ room }, 'ryan', (lines) => printed.push(...lines))
    await flush()
    await channels[0].join()
    await flush()

    // Nothing yet: the room is where it was when the channel opened.
    expect(printed).toHaveLength(0)

    // Said while the socket was dead. It arrives down no channel, which is the
    // whole problem — a reconnect alone would never show it.
    tables.posts.push({
      id: 2,
      room_slug: room,
      post_no: 2,
      author_id: 'a',
      body: 'the tomatoes are done',
      created_at: missed,
    })

    await suspendAndReturn(channels)

    expect(printed.map((l) => l.text)).toContain('the tomatoes are done')
    expect(printed[0].text).toMatch(/^2 {2}marisol, /)

    /*
     * And listening again — which catching up does not do by itself. A version
     * that only asked for the missed messages would look identical here and be
     * deaf from this moment on, so the proof is a live arrival down the new
     * channel rather than the presence of the channel.
     */
    expect(channels).toHaveLength(2)
    expect(channels[0].removed).toBe(true)

    await channels[1].say({
      author_id: 'a',
      post_no: 3,
      body: 'and the sauce',
      created_at: '2026-08-13T10:09:00.000Z',
    })
    expect(printed.map((l) => l.text)).toContain('and the sauce')
  })

  /*
   * The other kind of return, and the reason the handler asks before it acts.
   * Glancing at another tab on a computer leaves the socket exactly where it
   * was; rebuilding the channel every time somebody does that would be a
   * rejoin for nothing, several times a minute. A joined channel needs the
   * messages it missed and no more.
   */
  it('and asks for them without rebuilding a channel that never died', async () => {
    listeners.length = 0
    returnToTheApp()
    const tables = world()
    const { client, channels } = fakeClient(tables)
    const printed: Line[] = []

    const { createLive } = await import('@/lib/data/live')
    createLive(client, []).subscribe({ room }, 'ryan', (lines) => printed.push(...lines))
    await flush()
    await channels[0].join()
    await flush()

    tables.posts.push({ id: 2, room_slug: room, post_no: 2, author_id: 'a', body: 'still here', created_at: missed })

    // No suspension: the channel is still joined, as it would be on a computer.
    listeners.forEach((wake) => wake())
    await flush()

    expect(printed.map((l) => l.text)).toContain('still here')
    expect(channels).toHaveLength(1)
    expect(channels[0].removed).toBe(false)
  })

  it('and does not print it a second time on the next return', async () => {
    listeners.length = 0
    returnToTheApp()
    const tables = world()
    const { client, channels } = fakeClient(tables)
    const printed: Line[] = []

    const { createLive } = await import('@/lib/data/live')
    createLive(client, []).subscribe({ room }, 'ryan', (lines) => printed.push(...lines))
    await flush()
    await channels[0].join()
    await flush()

    tables.posts.push({ id: 2, room_slug: room, post_no: 2, author_id: 'a', body: 'twice?', created_at: missed })

    await suspendAndReturn(channels)
    await suspendAndReturn(channels)

    expect(printed.filter((l) => l.text === 'twice?')).toHaveLength(1)
  })

  it('stays quiet about words that are your own', async () => {
    listeners.length = 0
    returnToTheApp()
    const tables = world()
    const { client, channels } = fakeClient(tables)
    const printed: Line[] = []

    const { createLive } = await import('@/lib/data/live')
    createLive(client, []).subscribe({ room }, 'ryan', (lines) => printed.push(...lines))
    await flush()
    await channels[0].join()
    await flush()

    // Posted from this very session while it was in the background — the phone
    // does not stop being signed in when it stops being on the screen.
    tables.posts.push({ id: 2, room_slug: room, post_no: 2, author_id: 'b', body: 'mine', created_at: missed })

    await suspendAndReturn(channels)

    expect(printed).toHaveLength(0)
  })

  it('opens a new channel after one errors, instead of going quiet forever', async () => {
    listeners.length = 0
    returnToTheApp()
    const { client, channels } = fakeClient(world())

    const { createLive } = await import('@/lib/data/live')
    const stop = createLive(client, []).subscribe({ room }, 'ryan', () => {})
    await flush()
    expect(channels).toHaveLength(1)

    await channels[0].status?.('CHANNEL_ERROR')
    await new Promise((resolve) => setTimeout(resolve, 1_100))

    expect(channels.length).toBeGreaterThan(1)
    expect(channels[0].removed).toBe(true)
    stop()
  })

  it('caps a long absence, and points at look for the rest', async () => {
    listeners.length = 0
    returnToTheApp()
    const tables = world()
    const { client, channels } = fakeClient(tables)
    const printed: Line[] = []

    const { createLive } = await import('@/lib/data/live')
    createLive(client, []).subscribe({ room }, 'ryan', (lines) => printed.push(...lines))
    await flush()
    await channels[0].join()
    await flush()

    // A busy hour, or a phone left in a pocket over lunch.
    for (let n = 2; n <= 40; n += 1) {
      tables.posts.push({
        id: n,
        room_slug: room,
        post_no: n,
        author_id: 'a',
        body: `message ${n}`,
        created_at: `2026-08-13T11:${String(n).padStart(2, '0')}:00.000Z`,
      })
    }

    await suspendAndReturn(channels)

    // Twenty of them, two lines each, and one line saying where the rest are.
    expect(printed.filter((l) => /^message /.test(l.text))).toHaveLength(20)
    expect(printed[printed.length - 1].text).toMatch(/type look to read the room/)

    /*
     * And the backlog is behind us. Landing the watermark on the last row it
     * fetched would mean the next return prints another twenty of the same
     * vintage, and the one after that another twenty — a drip of old messages
     * every time somebody glances at the app.
     */
    printed.length = 0
    await suspendAndReturn(channels)
    expect(printed).toHaveLength(0)
  })

  /*
   * Two guards stop this — `teardown` clears the pending timer, and the timer
   * checks `closed` before doing anything — and removing either one on its own
   * leaves this passing. That is belt and braces rather than a redundancy to
   * clean up: a retry that fires into a room you have walked out of appends
   * somebody else's conversation to the one you are reading.
   */
  it('stops retrying once the room is left', async () => {
    listeners.length = 0
    returnToTheApp()
    const { client, channels } = fakeClient(world())

    const { createLive } = await import('@/lib/data/live')
    const stop = createLive(client, []).subscribe({ room }, 'ryan', () => {})
    await flush()
    await channels[0].status?.('TIMED_OUT')
    stop()

    await new Promise((resolve) => setTimeout(resolve, 1_100))
    expect(channels).toHaveLength(1)
  })
})
