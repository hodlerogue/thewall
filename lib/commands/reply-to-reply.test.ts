import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv, type Env } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import { renderPost } from '@/lib/shell/render'
import type { Post, Room } from '@/lib/shell/model'
import type { Line, Location } from '@/lib/shell/types'

/**
 * Answering a reply.
 *
 * "I want to be able to reply to replies." §4.3 gave replies no address, which
 * is exactly why there was nothing to answer — a thread with six replies in it
 * was six people talking past each other.
 *
 * That half is reversed and the half about nesting is not, which is the whole
 * design: a reply is numbered *within its post*, so `music/12` still addresses
 * the conversation and no URL grows a segment; and an answer to an answer sits
 * where it was written with a `→ 2` saying what it means, rather than indented
 * under it. §3.2 caps depth at two steps, and a fourth level on a 380px screen
 * leaves the words two characters wide.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')
const IN_POST: Location = { room: 'music', postId: 12 }

function post(replies: Post['replies']): Post {
  return {
    id: 12,
    author: 'jameson',
    body: 'found my dad’s records',
    createdAt: new Date('2026-08-01T10:00:00Z'),
    replies,
  }
}

function harness(name: string | null = 'ryan') {
  const written: { body: string; toReply?: number }[] = []
  /*
   * A thread with replies in it, because aiming at one that is not there is now
   * refused — and a fixture whose post has no replies would be asserting that
   * `reply 2` works in a thread where reply 2 cannot exist.
   */
  const rooms: Room[] = [
    {
      slug: 'music',
      gloss: 'what you are listening to',
      ephemeral: false,
      posts: [
        post([
          { id: 1, author: 'marisol', body: 'warped ones still play', createdAt: new Date() },
          { id: 2, author: 'tuck', body: 'what was in there', createdAt: new Date() },
          { id: 3, author: 'ren', body: 'worth it anyway', createdAt: new Date() },
        ]),
      ],
    },
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
      return 1
    },
    async reply(_room, _postNo, body, toReply) {
      written.push({ body, toReply })
      return written.length
    },
    async rename(n) {
      return { ok: true as const, name: n }
    },
  }
  const session = new Session(api, writer, name)
  return { run: createRunner(env, ['commons'], session), written, session }
}

describe('reply takes a number, and only reply does', () => {
  it('aims at the reply you name', async () => {
    const { run, written } = harness()
    await run('reply 2 that is the bit i meant', IN_POST)

    expect(written).toEqual([{ body: 'that is the bit i meant', toReply: 2 }])
  })

  it('answers the post when you name nothing, as it always has', async () => {
    const { run, written } = harness()
    await run('reply i agree with all of this', IN_POST)

    expect(written).toEqual([{ body: 'i agree with all of this', toReply: undefined }])
  })

  it('does not eat a number from say', async () => {
    /*
     * `say 2 hello` posts the words "2 hello". A verb that sometimes swallows
     * its first word is a verb nobody can predict, and `say` is content and
     * nothing else — that asymmetry is the point. `reply` is the one that takes
     * an address, because it is the one with something to point at.
     */
    const { run, written } = harness()
    await run('say 2 things happened today', IN_POST)

    expect(written).toEqual([{ body: '2 things happened today', toReply: undefined }])
  })

  it('treats a number with nothing after it as words, not an address', async () => {
    // `reply 2` is somebody who has not finished typing. Reading it as "answer
    // reply 2 with the empty string" would post nothing under somebody's name.
    const { run, written } = harness()
    const out = text((await run('reply 2', IN_POST)).lines)

    expect(written).toEqual([{ body: '2', toReply: undefined }])
    expect(out).not.toContain('→')
  })

  it('says which one it answered', async () => {
    const { run } = harness()
    const out = text((await run('reply 2 that is the bit i meant', IN_POST)).lines)
    expect(out).toContain('→ 2')
  })

  it('says nothing about a pointer when there is none', async () => {
    const { run } = harness()
    expect(text((await run('reply i agree', IN_POST)).lines)).not.toContain('→')
  })
})

describe('the number survives signing up', () => {
  it('still answers the reply you aimed at, two questions later', async () => {
    /*
     * §3.9 holds the sentence across the name and address questions. The number
     * has to be held with it — otherwise answering somebody quietly becomes
     * answering the post, at the exact moment the site promises nothing typed
     * is lost, and the person would have no way to notice.
     */
    const { run, written, session } = harness(null)

    await run('reply 3 this is what i think', IN_POST)
    expect(written).toEqual([])
    expect(session.isAsking()).toBe(true)

    await run('newcomer', IN_POST)
    await run('newcomer@example.org', IN_POST)

    expect(written).toEqual([{ body: 'this is what i think', toReply: 3 }])
  })
})

describe('what a thread looks like', () => {
  const at = (mins: number) => new Date(Date.parse('2026-08-01T12:00:00Z') + mins * 60_000)
  const thread = post([
    { id: 1, author: 'marisol', body: 'warped ones still play', createdAt: at(0) },
    { id: 2, author: 'tuck', body: 'what was in there', createdAt: at(10) },
    { id: 3, author: 'ren', body: 'that is what makes them worth it', createdAt: at(20), toReply: 1 },
  ])

  it('numbers every reply, so each one can be answered', () => {
    const lines = renderPost(thread, at(30)).map((l) => l.text)
    expect(lines.some((l) => l.startsWith('1  marisol'))).toBe(true)
    expect(lines.some((l) => l.startsWith('2  tuck'))).toBe(true)
    expect(lines.some((l) => l.startsWith('3  ren'))).toBe(true)
  })

  it('marks the one that answers another, and only that one', () => {
    const lines = renderPost(thread, at(30)).map((l) => l.text)
    expect(lines.find((l) => l.startsWith('3  ren'))).toContain('→ 1')
    expect(lines.find((l) => l.startsWith('1  marisol'))).not.toContain('→')
    expect(lines.find((l) => l.startsWith('2  tuck'))).not.toContain('→')
  })

  it('keeps them flat and in time order, never nested', () => {
    /*
     * The property that makes this readable on a phone. Reply 3 answers reply 1
     * and is still printed *after* reply 2, at the same indentation, because it
     * was written third. A tree would put it under 1 and push everything after
     * it sideways.
     */
    const lines = renderPost(thread, at(30))
    const headers = lines.filter((l) => /^\d+ {2}/.test(l.text))

    expect(headers.map((l) => l.text.slice(0, 1))).toEqual(['1', '2', '3'])
    expect(new Set(headers.map((l) => l.depth))).toEqual(new Set([1]))
  })

  it('says how to answer one, at the bottom where you have finished reading', () => {
    const lines = renderPost(thread, at(30)).map((l) => l.text)
    expect(lines[lines.length - 1]).toContain('reply 2 <something> answers 2')
  })
})
