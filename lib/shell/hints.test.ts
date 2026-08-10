import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { COMMANDS } from '@/lib/commands/registry'
import { fixtureEnv, type Env, type MailItem } from '@/lib/shell/env'
import { HINTS_KEY, withoutHints } from '@/lib/shell/hints'
import { renderPost, renderRoom, renderRoomList } from '@/lib/shell/render'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Post, Room } from '@/lib/shell/model'
import type { Line, Location } from '@/lib/shell/types'

/**
 * Being told what to type, and being able to stop being told.
 *
 * "Not sure people want to be constantly given instructions. There should be a
 * setting that allows you to turn that off for sure."
 *
 * §3.6 argues the opposite and both are right about different people: an
 * interface that teaches itself is what makes a command prompt usable by
 * somebody who has never opened one, and the same line on the four hundredth
 * `look` is the site talking over the conversation. So the lines stay, default
 * on, and one word ends them.
 *
 * **The rule about what may be silenced is the whole of this file.** A hint
 * teaches a command you could type next. A line reporting something you cannot
 * otherwise see is not a hint however instructional it sounds — silence those
 * and the silent truncation they were written to end comes straight back. And
 * an error is never a hint: it is the answer to something you just did.
 */

const text = (lines: readonly Line[]) => lines.map((l) => l.text).join('\n')
const at = (m: number) => new Date(Date.parse('2026-08-01T12:00:00Z') + m * 60_000)

function post(id: number, replies = 0): Post {
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

function harness(items: MailItem[] = [], name: string | null = 'ryan') {
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
      return { ok: true as const, name: n, note: '' }
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
  return { run: createRunner(env, ['commons'], new Session(api, writer, name)) }
}

describe('what may be switched off', () => {
  it('the line telling you how to answer a thread', () => {
    const lines = renderPost(post(12, 1), at(60))
    const closing = lines[lines.length - 1]

    expect(closing.text).toContain('reply <something> answers the post')
    expect(closing.hint).toBe(true)
  })

  it('and commons repeating what commons is, every time you look', () => {
    const room: Room = { slug: 'commons', gloss: 'briefly', ephemeral: true, posts: [post(4)] }
    const banner = renderRoom(room, at(60))[0]

    expect(banner.text).toContain('commons keeps nothing')
    expect(banner.hint).toBe(true)
  })
})

describe('what may never be', () => {
  it('a room admitting it is showing you a slice', () => {
    /*
     * `older — the page before this one` reads like an instruction and is not
     * one: it is the site saying there is content you cannot see. Silencing it
     * brings back the silent truncation it was written to end — a room that
     * stops on a blank line, indistinguishable from a room you have read.
     */
    const room: Room = {
      slug: 'big',
      gloss: 'a lot of talking',
      ephemeral: false,
      posts: [post(9)],
      more: true,
    }
    const older = renderRoom(room, at(60)).find((l) => l.text.startsWith('older'))

    expect(older, 'the notice is gone entirely').toBeDefined()
    expect(older!.hint).toBeUndefined()
  })

  it('nor the lobby saying how many rooms it left out', () => {
    const lines = renderRoomList(
      [{ slug: 'music', gloss: 'g', ephemeral: false, curated: true }],
      at(60),
      56,
      40,
    )
    const more = lines.find((l) => l.text.includes('more rooms'))

    expect(more, 'the count is gone entirely').toBeDefined()
    expect(more!.hint).toBeUndefined()
  })

  it('nor mail admitting it cleared replies it never showed you', async () => {
    const many: MailItem[] = Array.from({ length: 100 }, (_, i) => ({
      room: 'music',
      postId: 12,
      author: 'ren',
      body: `reply ${i}`,
      createdAt: at(i),
    }))
    const lines = (await harness(many).run('mail', {} as Location)).lines
    const cap = lines.find((l) => l.text.includes('newest 100'))

    expect(cap, 'the cap notice is gone entirely').toBeDefined()
    expect(cap!.hint).toBeUndefined()
  })

  it('nor any error, which is the answer to something you just did', async () => {
    const { run } = harness()
    for (const input of ['go nowhere-at-all', 'reply', 'gooo music', 'theme puce']) {
      const lines = (await run(input, { room: 'music' })).lines
      expect(lines.length, input).toBeGreaterThan(0)
      for (const line of lines) expect(line.hint, `${input}: ${line.text}`).toBeUndefined()
    }
  })
})

describe('switching them off', () => {
  it('drops the hints and keeps everything else', () => {
    const lines = renderPost(post(12, 2), at(60))
    const quiet = withoutHints(lines, false)

    expect(text(quiet)).toContain('answer 1')
    expect(text(quiet)).toContain('answer 2')
    expect(text(quiet)).not.toContain('reply <something> answers the post')
  })

  it('and does not leave the gap the hint was sitting under', () => {
    // The renderers separate a listing from its instruction with a blank line.
    // Dropping the instruction alone ends the room on two blank lines and a
    // hole where nothing was said.
    const quiet = withoutHints(renderPost(post(12, 1), at(60)), false)
    expect(quiet[quiet.length - 1].text).not.toBe('')
  })

  it('but keeps a gap that is part of the listing', () => {
    // Only trailing ones. A room separates its posts with blanks, and eating
    // those would run every post into the next.
    const room: Room = { slug: 'music', gloss: 'g', ephemeral: false, posts: [post(1), post(2)] }
    const quiet = withoutHints(renderRoom(room, at(60)), false)
    expect(quiet.some((l) => l.text === '')).toBe(true)
  })

  it('changes nothing at all when they are on', () => {
    const lines = renderPost(post(12, 1), at(60))
    expect(withoutHints(lines, true)).toEqual(lines)
  })
})

describe('the command that does it', () => {
  const found = COMMANDS.find((c) => c.verb === 'hints')!

  it('exists, is not hidden, and works from everywhere', () => {
    // Being talked at is not context-sensitive, and neither is wanting it to
    // stop — the same argument `help` is listed everywhere for.
    expect(found).toBeDefined()
    expect(found.hidden).toBeFalsy()
    expect(found.contexts).toEqual(['lobby', 'room', 'commons', 'post', 'person'])
  })

  it('answers to the word somebody annoyed would reach for', () => {
    expect(found.aliases).toContain('quiet')
  })

  it('says which way it is set, without changing it', async () => {
    const { run } = harness()
    expect(text((await run('hints', { room: 'music' })).lines)).toContain('hints are on')
  })

  it('names both ways out rather than guessing', async () => {
    const { run } = harness()
    const out = text((await run('hints maybe', { room: 'music' })).lines)
    expect(out).toContain('hints on or hints off')
  })

  it('confirms in a line that is not itself a hint', async () => {
    /*
     * Otherwise `hints off` answers with silence, and the person who just typed
     * it cannot tell the command from a typo.
     */
    const { run } = harness()
    const lines = (await run('hints off', { room: 'music' })).lines

    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line.hint).toBeUndefined()
    expect(text(lines)).toContain('hints off')
  })

  it('is remembered on this device rather than on the account', () => {
    // A preference about this screen, like `theme` — so it needs no column, no
    // round trip and no account, and a guest can have one.
    expect(HINTS_KEY).toBe('thewall.hints')
  })
})

describe('the shortest form that works from where you are', () => {
  it('mail names a bare number when the post is in the room you are in', async () => {
    /*
     * "I'm in a room called kitchen and it's telling me to reply by doing
     * kitchen/6. Inside kitchen all I have to do is go 6, so that seems
     * misleading."
     */
    const items: MailItem[] = [
      { room: 'music', postId: 12, author: 'ren', body: 'still play', createdAt: at(50) },
    ]
    const { run } = harness(items)
    const out = text((await run('mail', { room: 'music' })).lines)

    expect(out).toContain('reply 12 <something>')
    expect(out).not.toContain('reply music/12 <something>')
  })

  it('and the whole address from anywhere else', async () => {
    const items: MailItem[] = [
      { room: 'music', postId: 12, author: 'ren', body: 'still play', createdAt: at(50) },
    ]
    const { run } = harness(items)
    const out = text((await run('mail', { room: 'poker' })).lines)

    expect(out).toContain('reply music/12 <something>')
  })

  it('including from the lobby, where a bare number means nothing', async () => {
    const items: MailItem[] = [
      { room: 'music', postId: 12, author: 'ren', body: 'still play', createdAt: at(50) },
    ]
    const { run } = harness(items)
    expect(text((await run('mail', {} as Location)).lines)).toContain('reply music/12')
  })
})
