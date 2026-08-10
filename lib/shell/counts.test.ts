import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv, type Env } from '@/lib/shell/env'
import { renderFeed, renderPosts, renderRoom, withOneMoreReply } from '@/lib/shell/render'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Post, Room } from '@/lib/shell/model'
import type { Line, Location } from '@/lib/shell/types'

/**
 * The one line a listing prints that goes stale while you are looking at it.
 *
 * "I'm replying using the reply 5 feature and it works, but it doesn't auto
 * update the original post — it still shows as 1 reply underneath it."
 *
 * Correct, and the data was never wrong: `look` re-reads a live count. What was
 * wrong is the line already on the screen, and on a phone the screen is the
 * whole interface. `reply 7 <something>` was built so you never have to leave
 * the room listing; a listing that then lies about the thing you just did takes
 * back most of what the feature bought.
 *
 * So the count carries what it is a count of, and a reply that lands rewrites
 * every printed copy of it. Narrowly: **nothing anybody wrote is ever rewritten
 * in the scrollback.** A post's body, a reply, somebody's sentence — those are a
 * record. This is a number the site derived about itself, which is a different
 * kind of thing, and the assertions below pin that line.
 */

const at = (mins: number) => new Date(Date.parse('2026-08-01T12:00:00Z') + mins * 60_000)
const counted = (lines: readonly Line[]) => lines.filter((l) => l.counts)

function post(id: number, replies: number): Post {
  return {
    id,
    author: 'marisol',
    body: `post number ${id}`,
    createdAt: at(0),
    replies: Array.from({ length: replies }, (_, i) => ({
      id: i + 1,
      author: 'ren',
      body: `answer ${i + 1}`,
      createdAt: at(i + 1),
    })),
  }
}

function harness(name: string | null = 'ryan') {
  const rooms: Room[] = [
    {
      slug: 'music',
      gloss: 'what you are listening to',
      ephemeral: false,
      posts: [post(7, 1), post(5, 0)],
    },
    { slug: 'commons', gloss: 'briefly', ephemeral: true, posts: [post(4, 0)] },
  ]
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
    async loginCode(n) {
      return { ok: true as const, name: n }
    },
    async resend() {
      return { note: '' }
    },
  }
  const writer: Writer = {
    async post() {
      return 9
    },
    async reply() {
      return 2
    },
    async rename(n) {
      return { ok: true as const, name: n }
    },
  }

  return { env, run: createRunner(env, ['commons'], new Session(api, writer, name)) }
}

describe('the count line says what it is counting', () => {
  it('in a room, against the post it belongs to', async () => {
    const { env } = harness()
    const lines = renderRoom((await env.getRoom('music'))!, at(60))
    const marked = counted(lines)

    expect(marked).toHaveLength(1)
    expect(marked[0].counts).toEqual({ room: 'music', postId: 7, replies: 1, goTo: '7' })
    expect(marked[0].text).toBe('1 reply — go 7')
  })

  it('and on the feed, where the address needs the wall in front', async () => {
    const lines = renderFeed(
      [
        {
          room: '~marisol',
          id: 2,
          author: 'marisol',
          body: 'mine too',
          createdAt: at(30),
          replies: 3,
        },
      ],
      at(60),
    )
    const marked = counted(lines)

    expect(marked[0].counts).toEqual({
      room: '~marisol',
      postId: 2,
      replies: 3,
      goTo: '~marisol/2',
    })
    expect(marked[0].text).toBe('3 replies — go ~marisol/2')
  })

  it('and nowhere in commons, which has no replies to count', () => {
    // §3.10 — no threads there at all, so there is no line and nothing to keep
    // true. A marked line in commons would be one waiting to be updated by
    // something that cannot happen.
    expect(counted(renderPosts([post(4, 0)], true, at(60), 'commons'))).toHaveLength(0)
  })

  it('and not at all for a post nobody has answered', () => {
    // No line is printed, so there is nothing to correct — and nothing on the
    // screen is wrong afterwards either, which is the property that matters.
    const lines = renderPosts([post(5, 0)], false, at(60), 'music')
    expect(counted(lines)).toHaveLength(0)
  })
})

describe('one more answer', () => {
  it('counts up, and says it in the right grammar', () => {
    const [line] = counted(renderPosts([post(7, 1)], false, at(60), 'music'))

    const after = withOneMoreReply(line)
    expect(after.text).toBe('2 replies — go 7')
    expect(after.counts?.replies).toBe(2)

    // And again, because a second answer is not a special case.
    expect(withOneMoreReply(after).text).toBe('3 replies — go 7')
  })

  it('keeps the address it was printed with', () => {
    const [line] = counted(
      renderFeed(
        [{ room: '~marisol', id: 2, author: 'm', body: 'x', createdAt: at(0), replies: 1 }],
        at(60),
      ),
    )
    expect(withOneMoreReply(line).text).toBe('2 replies — go ~marisol/2')
  })

  it('leaves every other line exactly as it was', () => {
    // The guard that keeps this from becoming "the scrollback is editable".
    const lines = renderRoom({ slug: 'music', gloss: 'g', ephemeral: false, posts: [post(7, 1)] })
    for (const line of lines.filter((l) => !l.counts)) {
      expect(withOneMoreReply(line)).toEqual(line)
    }
  })
})

describe('a reply says which post it landed on', () => {
  it('when answered from the room listing, without opening it', async () => {
    const { run } = harness()
    const result = await run('reply 7 the same thing happens to me', { room: 'music' })
    expect(result.answered).toEqual({ room: 'music', postId: 7 })
  })

  it('when answered by its whole address, from somewhere else', async () => {
    const { run } = harness()
    const result = await run('reply music/7 i had that record too', {} as Location)
    expect(result.answered).toEqual({ room: 'music', postId: 7 })
  })

  it('when answered from inside the post, where say means reply', async () => {
    // The listing may still be on screen above the thread you walked into.
    const { run } = harness()
    const result = await run('say i agree', { room: 'music', postId: 7 })
    expect(result.answered).toEqual({ room: 'music', postId: 7 })
  })

  it('and says nothing when the contribution was a new post', async () => {
    const { run } = harness()
    expect((await run('say a brand new thing', { room: 'music' })).answered).toBeUndefined()
  })

  it('and nothing when the reply did not land', async () => {
    const broken: Writer = {
      async post() {
        return 1
      },
      async reply() {
        throw new Error('that didn’t send. try again?')
      },
      async rename(n) {
        return { ok: true as const, name: n }
      },
    }
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
        return { ok: true as const, name: n, note: '' }
      },
      async loginCode(n) {
        return { ok: true as const, name: n }
      },
      async resend() {
        return { note: '' }
      },
    }
    const run = createRunner(fixtureEnv(), ['commons'], new Session(api, broken, 'ryan'))
    expect((await run('reply 12 hello', { room: 'music' })).answered).toBeUndefined()
  })

  it('and still does, two signup questions after it was typed', async () => {
    /*
     * The held sentence lands long after the listing was printed, and it is the
     * commonest first reply anybody makes — so a field only the signed-in path
     * sets would leave the count stale for exactly the people seeing the room
     * for the first time.
     */
    const { run } = harness(null)

    await run('reply 7 my first words here', { room: 'music' })
    await run('newcomer', { room: 'music' })
    const done = await run('newcomer@example.org', { room: 'music' })

    expect(done.answered).toEqual({ room: 'music', postId: 7 })
  })
})
