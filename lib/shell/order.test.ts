import { describe, expect, it } from 'vitest'
import { renderFeed, renderPost, renderProfile, renderRoom } from '@/lib/shell/render'
import type { Post, PostHit, Profile, Room } from '@/lib/shell/model'
import type { Line } from '@/lib/shell/types'

/**
 * Which way time runs on the screen.
 *
 * This is the assertion that did not exist, which is why it was wrong in five
 * places at once. Every renderer here was checked for *what* it printed and
 * never for the order, so newest-first survived from the first commit — and
 * newest-first is wrong for a reason that only shows up when you run the thing:
 * `Terminal` sets `scrollTop = scrollHeight` after every command, so the view
 * lands on the last line written. Printing the newest post first put it at the
 * top of a block that is immediately scrolled past, and filled the screen with
 * the oldest thirty posts in the room.
 *
 * The queries are unchanged and still ask for the newest N. Only the printing
 * is reversed. So the fixtures below arrive newest-first, exactly as the
 * database hands them over, and every assertion is that the oldest one comes
 * out on top.
 */

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000)

/** Newest first — the order every query in lib/data/supabaseEnv.ts returns. */
const NEWEST_FIRST = [
  { body: 'third, and the newest', when: 5 },
  { body: 'second, in the middle', when: 50 },
  { body: 'first, and the oldest', when: 500 },
]

/** Where each body landed, by line index. -1 if it never printed. */
function positions(lines: Line[]): number[] {
  return NEWEST_FIRST.map((item) => lines.findIndex((line) => line.text.includes(item.body)))
}

function expectOldestOnTop(lines: Line[]) {
  const [newest, middle, oldest] = positions(lines)
  expect(oldest).toBeGreaterThanOrEqual(0)
  expect(oldest).toBeLessThan(middle)
  expect(middle).toBeLessThan(newest)
}

const hits: PostHit[] = NEWEST_FIRST.map((item, i) => ({
  room: 'music',
  id: 30 - i,
  author: 'marisol',
  body: item.body,
  createdAt: at(item.when),
}))

describe('time runs down the screen, not up it', () => {
  it('a room puts its newest post nearest the prompt', () => {
    const room: Room = {
      slug: 'music',
      gloss: 'what you are listening to',
      ephemeral: false,
      posts: NEWEST_FIRST.map((item, i) => ({
        id: 30 - i,
        author: 'marisol',
        body: item.body,
        createdAt: at(item.when),
        replies: [],
      })),
    }
    expectOldestOnTop(renderRoom(room))
  })

  it('commons does too, even though nothing there has an address', () => {
    // Different branch — no post numbers, no reply counts — so it can and did
    // drift from the room listing it sits beside.
    const room: Room = {
      slug: 'commons',
      gloss: 'today, out loud',
      ephemeral: true,
      posts: NEWEST_FIRST.map((item, i) => ({
        id: 30 - i,
        author: 'marisol',
        body: item.body,
        createdAt: at(item.when),
        replies: [],
      })),
    }
    expectOldestOnTop(renderRoom(room))
  })

  it('the feed does', () => {
    expectOldestOnTop(renderFeed(hits))
  })

  it('a profile does, and still points at the newest afterwards', () => {
    const profile: Profile = {
      name: 'marisol',
      joinedAt: at(10_000),
      verified: true,
      posts: hits,
    }
    const lines = renderProfile(profile)
    expectOldestOnTop(lines)

    // The closing line reads off `posts[0]`, which is still the newest because
    // only the printing was reversed. If that ever silently becomes the oldest,
    // the instruction sends people to the wrong post.
    const closing = lines[lines.length - 1].text
    expect(closing).toContain('30')
  })

  it('replies inside a post were already right, and stay right', () => {
    /*
     * §4.3 sorts replies chronologically and the query asks for them ascending,
     * so this one never had the bug. It is asserted anyway: the fix reversed
     * four renderers, and reversing this fifth one would have been the easy
     * mistake to make while doing it.
     */
    const post: Post = {
      id: 12,
      author: 'jameson',
      body: 'found my dad’s records in the garage',
      createdAt: at(600),
      replies: [
        { author: 'marisol', body: 'first, and the oldest', createdAt: at(500) },
        { author: 'ren', body: 'second, in the middle', createdAt: at(50) },
        { author: 'tuck', body: 'third, and the newest', createdAt: at(5) },
      ],
    }
    expectOldestOnTop(renderPost(post))
  })
})
