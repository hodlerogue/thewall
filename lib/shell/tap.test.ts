import { describe, expect, it } from 'vitest'
import { parse } from '@/lib/commands/parse'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv, type Env, type MailItem } from '@/lib/shell/env'
import { renderFeed, renderPost, renderPosts, renderProfile } from '@/lib/shell/render'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Post } from '@/lib/shell/model'
import type { Line, Location } from '@/lib/shell/types'

/**
 * Tapping an address to answer it.
 *
 * "What happens when we're on reply 239482 — typing that number in each time
 * will be real annoying." Reply numbers are allocated per post, so that one
 * would need a thread with a quarter of a million answers in it; **post**
 * numbers are per room, and `music/8431` is an ordinary thing a busy room
 * reaches. Either way the complaint is right about the shape of the work:
 * answering means typing back a number that is already on the screen.
 *
 * So the address at the head of every "somebody said this" line is a button,
 * and tapping it *inserts* `reply 8431 ` with the cursor waiting. It never
 * runs — that is the palette's contract (§3.6), and it is the difference
 * between an interface people graduate to typing and a set of buttons wearing
 * a terminal costume (§9).
 *
 * Two invariants, and they are why this file exists rather than a handful of
 * assertions spread over the renderers. **The token has to be a prefix of the
 * line**, because the button is drawn by splitting the text at it — get that
 * wrong and the line renders with characters missing, silently. And **what it
 * inserts has to be a line the site accepts**, which is CHANGING-IT's oldest
 * rule: when something says "try X", type X into the thing and see.
 */

const at = (mins: number) => new Date(Date.parse('2026-08-01T12:00:00Z') + mins * 60_000)

const post = (id: number, replies: Post['replies'] = []): Post => ({
  id,
  author: 'marisol',
  body: 'found my dad’s records',
  createdAt: at(0),
  replies,
})

/** Every line any renderer produces that claims a tap target. */
function everyTappableLine(): Line[] {
  const thread = post(8431, [
    { id: 1, author: 'ren', body: 'warped ones still play', createdAt: at(10) },
    { id: 2, author: 'tuck', body: 'what was in there', createdAt: at(20), toReply: 1 },
  ])

  return [
    ...renderPosts([thread], false, at(60)),
    ...renderPost(thread, at(60)),
    ...renderFeed(
      [{ room: '~marisol', id: 2, author: 'marisol', body: 'mine too', createdAt: at(30) }],
      at(60),
    ),
    ...renderProfile(
      {
        name: 'marisol',
        joinedAt: at(0),
        verified: true,
        posts: [
          { room: 'music', id: 8431, author: 'marisol', body: 'hello', createdAt: at(30) },
          {
            room: 'poker',
            id: 4,
            author: 'marisol',
            body: 'deal me in',
            createdAt: at(40),
            isReply: true,
          },
        ],
      },
      at(60),
    ),
  ]
}

describe('the token is a slice of the line it sits on', () => {
  it('holds for every line any renderer produces', () => {
    /*
     * `Scrollback` renders `text.slice(token.length)` after the button. A token
     * that is not the start of the text therefore eats the wrong characters —
     * `music/12  ren` rendered with a token of `12` would print
     * `12sic/12  ren`, and nothing else in the suite looks at the two together.
     */
    const tapped = everyTappableLine().filter((line) => line.tap)
    expect(tapped.length).toBeGreaterThan(4)

    for (const line of tapped) {
      expect(line.text.startsWith(line.tap!.token), line.text).toBe(true)
    }
  })

  it('and the rest of the line still reads as it always did', () => {
    // The header shape is asserted all over this suite by reading `text` whole.
    // Splitting the line for the button must not change what `text` says.
    const [header] = renderPosts([post(8431)], false, at(60))
    expect(header.text).toMatch(/^8431 {2}marisol, /)
  })
})

describe('what it types is a line the site accepts', () => {
  it('is always a real command with the address as its argument', () => {
    for (const line of everyTappableLine().filter((l) => l.tap)) {
      const parsed = parse(line.tap!.insert)
      expect(parsed?.command?.verb, line.tap!.insert).toBe('reply')
      // The trailing space matters: `reply 8431` with the words typed straight
      // on the end would read as one word, and `reply 8431hello` is nonsense.
      expect(line.tap!.insert.endsWith(' ')).toBe(true)
      expect(parsed?.arg).toBe(line.tap!.token)
    }
  })

  it('and typing it, with words after, actually sends the reply', async () => {
    const written: { room: string; postNo: number; body: string }[] = []

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
        return 1
      },
      async reply(room, postNo, body) {
        written.push({ room, postNo, body })
        return written.length
      },
      async rename(n) {
        return { ok: true as const, name: n }
      },
    }

    const env = fixtureEnv()
    const run = createRunner(env, ['commons'], new Session(api, writer, 'ryan'))

    // The address a room listing actually prints, taken from the line itself
    // rather than written down here — this is the round trip, not a fixture.
    const room = await env.getRoom('music')
    const [header] = renderPosts(room!.posts.slice(0, 1), false)
    await run(`${header.tap!.insert}that record is still good`, { room: 'music' } as Location)

    expect(written).toEqual([
      { room: 'music', postNo: room!.posts[0].id, body: 'that record is still good' },
    ])
  })
})

describe('which lines offer it, and which deliberately do not', () => {
  it('offers it on a post in a room, where the number is the long one', () => {
    const [header] = renderPosts([post(8431)], false, at(60))
    expect(header.tap).toEqual({ token: '8431', insert: 'reply 8431 ' })
  })

  it('offers it on every reply in a thread', () => {
    const lines = renderPost(
      post(12, [
        { id: 1, author: 'ren', body: 'a', createdAt: at(10) },
        { id: 2, author: 'tuck', body: 'b', createdAt: at(20) },
      ]),
      at(60),
    )
    expect(lines.filter((l) => l.tap).map((l) => l.tap!.insert)).toEqual([
      'reply 1 ',
      'reply 2 ',
    ])
  })

  it('offers nothing in commons, which has no addresses to offer', () => {
    /*
     * §3.10 — commons keeps nothing, so its posts have no numbers and its
     * headers are who and when. A tap target there would be a button that
     * inserts a command the site refuses, which is worse than no button.
     */
    const lines = renderPosts([post(4)], true, at(60))
    expect(lines.some((l) => l.tap)).toBe(false)
    expect(lines[0].text).toMatch(/^marisol, /)
  })

  it('does not turn a body into a button', () => {
    // Only the header. The words somebody wrote are for reading, and a tap
    // target over a paragraph is a paragraph you cannot select on a phone.
    const lines = renderPosts([post(8431)], false, at(60))
    const body = lines.find((l) => l.text === 'found my dad’s records')
    expect(body?.tap).toBeUndefined()
  })

  it('offers it on every line of mail, which is the list of things to answer', async () => {
    const items: MailItem[] = [
      { room: 'music', postId: 8431, author: 'ren', body: 'still play', createdAt: at(50) },
      { room: 'poker', postId: 4, author: 'tuck', body: 'in', createdAt: at(55) },
    ]
    const base = fixtureEnv()
    const env: Env = { ...base, async readMail() { return items } }

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
        return 1
      },
      async reply() {
        return 1
      },
      async rename(n) {
        return { ok: true as const, name: n }
      },
    }
    const run = createRunner(env, ['commons'], new Session(api, writer, 'jameson'))

    const lines = (await run('mail', {} as Location)).lines
    const inserts = lines.filter((l) => l.tap).map((l) => l.tap!.insert)

    // Oldest first, like the listing.
    expect(inserts).toEqual(['reply poker/4 ', 'reply music/8431 '])
    for (const line of lines.filter((l) => l.tap)) {
      expect(line.text.startsWith(line.tap!.token)).toBe(true)
    }
  })
})
