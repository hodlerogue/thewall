import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { echoOf } from '@/lib/commands/run'
import { fixtureEnv, type Env } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Post, Room } from '@/lib/shell/model'
import type { Line, Location } from '@/lib/shell/types'

/**
 * Answering a post without opening it.
 *
 * "I want a command where you can reply to a post without opening it. For
 * example reply/5 your reply here." The spelling is the one thing that could
 * not be granted: `music/12` already means "post 12 in music", so `reply/5`
 * reads as post 5 in a room called reply. A slash there would have made the
 * site's one address separator mean two different things depending on which
 * word came before it.
 *
 * So the grammar is borrowed whole from `go`, which had already answered this:
 * a bare number is the numbered thing where you are standing, and `room/number`
 * is a whole address that works from anywhere. Nothing new to learn, and the
 * address form is the one `find`, `mail` and a profile already print — so the
 * thing to type back is on the screen in front of you.
 *
 * Two properties hold everything else up: **a reply never goes anywhere until
 * the post it names is known to exist**, and **you do not move**. The first is
 * what stops a mistyped number from taking a sentence — or two signup
 * questions — with it. The second is the whole feature.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')
const at = (mins: number) => new Date(Date.parse('2026-08-01T12:00:00Z') + mins * 60_000)

function post(id: number, body: string): Post {
  return { id, author: 'marisol', body, createdAt: at(id), replies: [] }
}

function harness(name: string | null = 'ryan') {
  const written: { room: string; postNo: number; body: string; toReply?: number }[] = []
  const posted: { room: string; body: string }[] = []

  const rooms: Room[] = [
    {
      slug: 'music',
      gloss: 'what you are listening to',
      ephemeral: false,
      posts: [
        // Post 12 has answers in it: aiming at a reply that is not there is
        // refused, so a thread with none would prove the wrong thing.
        {
          ...post(12, 'found my dad’s records'),
          replies: [
            { id: 1, author: 'ren', body: 'warped ones still play', createdAt: at(10) },
            { id: 2, author: 'tuck', body: 'what was in there', createdAt: at(20) },
          ],
        },
        post(7, 'anyone else awake'),
      ],
    },
    { slug: 'poker', gloss: 'the tuesday game', ephemeral: false, posts: [post(3, 'we are on')] },
    { slug: 'empty', gloss: 'nothing yet', ephemeral: false, posts: [] },
    { slug: 'commons', gloss: 'everything, briefly', ephemeral: true, posts: [post(4, 'hello')] },
    {
      slug: '~marisol',
      gloss: 'marisol’s wall',
      ephemeral: false,
      owner: 'marisol',
      posts: [post(2, 'the warped ones still play')],
    },
    { slug: 'feed', gloss: 'everything on every wall', ephemeral: false, posts: [] },
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
    async post(room, body) {
      posted.push({ room, body })
      return 99
    },
    async reply(room, postNo, body, toReply) {
      written.push({ room, postNo, body, toReply })
      // Per post, like the real allocator.
      return written.filter((r) => r.room === room && r.postNo === postNo).length
    },
    async rename(n) {
      return { ok: true as const, name: n }
    },
  }

  const session = new Session(api, writer, name)
  return { run: createRunner(env, ['commons'], session), written, posted, session }
}

const IN_MUSIC: Location = { room: 'music' }
const IN_POKER: Location = { room: 'poker' }
const LOBBY: Location = {}

describe('a number, in the room you are standing in', () => {
  it('answers that post without opening it', async () => {
    const { run, written } = harness()
    await run('reply 7 the same thing happens to me', IN_MUSIC)

    expect(written).toEqual([
      { room: 'music', postNo: 7, body: 'the same thing happens to me', toReply: undefined },
    ])
  })

  it('leaves you exactly where you were, which is the whole point', async () => {
    /*
     * "Without opening it." A reply that walked you into the post would be
     * `go 7` with extra steps — and it would throw away the listing you were
     * reading, which is the thing you were replying *from*.
     */
    const { run } = harness()
    const result = await run('reply 7 quick one', IN_MUSIC)
    expect(result.location).toBeUndefined()
  })

  it('says where it landed, because the prompt does not', async () => {
    // Standing inside the post, the address is on the prompt one line below and
    // the reply's own number is the only new fact. From outside, neither is on
    // the screen — so a bare number would be a receipt for a conversation you
    // cannot see.
    const { run } = harness()
    const out = text((await run('reply 7 quick one', IN_MUSIC)).lines)
    expect(out).toContain('music/7')
    expect(out).toContain('ryan, just now')
  })

  it('refuses a post that is not there, and names one that is', async () => {
    /*
     * Checked before anything is written. The alternative is worse than an
     * error: the sentence reaches the database, which refuses it, and by then
     * it is gone — and for somebody with no account it would ask two signup
     * questions first and fail after them.
     */
    const { run, written } = harness()
    const out = text((await run('reply 999 are you sure', IN_MUSIC)).lines)

    expect(written).toEqual([])
    expect(out).toContain('there’s nothing at music/999')
    expect(out).toContain('music/12')
  })

  it('says a room with nothing in it has nothing to answer', async () => {
    const { run } = harness()
    const out = text((await run('reply 1 hello', { room: 'empty' })).lines)
    expect(out).toContain('there’s nothing in empty')
  })

  it('does not eat the number when there is nothing after it', async () => {
    // Somebody who has not finished typing. Posting an empty reply under their
    // name would be the one unrecoverable reading of this line.
    const { run, written } = harness()
    const out = text((await run('reply 7', IN_MUSIC)).lines)

    expect(written).toEqual([])
    expect(out).toContain('goes on the same line')
  })

  it('asks which one when no number was given, keeping the words', async () => {
    // §3.7 — the fix is a line they can run, with their own sentence already in
    // it, rather than an instruction to start over.
    const { run } = harness()
    const out = text((await run('reply that is exactly right', IN_MUSIC)).lines)
    expect(out).toContain('reply 12 that is exactly right')
  })
})

describe('a whole address, from anywhere', () => {
  it('works from another room', async () => {
    const { run, written } = harness()
    await run('reply music/12 i had that record too', IN_POKER)

    expect(written).toEqual([
      { room: 'music', postNo: 12, body: 'i had that record too', toReply: undefined },
    ])
  })

  it('works from the lobby, where there is no room to be relative to', async () => {
    const { run, written } = harness()
    await run('reply music/12 from out here', LOBBY)
    expect(written).toEqual([
      { room: 'music', postNo: 12, body: 'from out here', toReply: undefined },
    ])
  })

  it('works from commons, which is why reply is offered there now', async () => {
    /*
     * `reply` used to be left out of commons entirely, on the correct reasoning
     * that it could never work there — §3.10 keeps no threads and the schema
     * refuses replies in an ephemeral room. Naming a post changes that: the
     * reply is not going *in* commons, it is going to music.
     */
    const { run, written } = harness()
    await run('reply music/12 answering from the noisy room', { room: 'commons' })
    expect(written).toEqual([
      { room: 'music', postNo: 12, body: 'answering from the noisy room', toReply: undefined },
    ])
  })

  it('reaches a wall, because a wall is a room', async () => {
    const { run, written } = harness()
    await run('reply ~marisol/2 mine are warped too', IN_MUSIC)
    expect(written).toEqual([
      { room: '~marisol', postNo: 2, body: 'mine are warped too', toReply: undefined },
    ])
  })

  it('names the address it landed at, since you are somewhere else', async () => {
    const { run } = harness()
    const out = text((await run('reply music/12 i had that record too', IN_POKER)).lines)
    expect(out).toMatch(/^music\/12 {2}1 {2}ryan, just now$/m)
  })

  it('does not name it when you were standing there all along', async () => {
    /*
     * The existing shape, unchanged, and worth pinning: inside the post the
     * address is already in the prompt, and repeating it under every reply is
     * the receipt line this codebase keeps deleting.
     */
    const { run } = harness()
    const out = text((await run('reply yes exactly', { room: 'music', postId: 12 })).lines)
    expect(out).not.toContain('music/12')
    expect(out).toMatch(/^\d+ {2}ryan, just now$/m)
  })

  it('says so when the room does not exist', async () => {
    const { run, written } = harness()
    const out = text((await run('reply muzik/12 hello', IN_MUSIC)).lines)
    expect(written).toEqual([])
    expect(out).toContain('there’s no room called muzik')
  })

  it('says why a post in commons cannot be answered', async () => {
    // Not "there's nothing at commons/4" — there is, for another few hours.
    // What is true is that nothing there is kept, and that is the answer.
    const { run, written } = harness()
    const out = text((await run('reply commons/4 hello back', IN_MUSIC)).lines)

    expect(written).toEqual([])
    expect(out).toContain('keeps nothing for longer than a day')
  })

  it('sends people to the whole address on the feed, where a number means five things', async () => {
    const { run, written } = harness()
    const out = text((await run('reply 2 nice', { room: 'feed' })).lines)

    expect(written).toEqual([])
    expect(out).toContain('the number needs the name')
  })

  it('and does not tell them the feed is empty, which it is not', async () => {
    /*
     * The feed holds nothing of its own — it is a view of walls — so asking it
     * for a post to name back answered "there's nothing in feed to answer yet"
     * under a screen full of things to answer. That is the empty-room lie, on
     * its fifth surface: `go feed`, the URL, the lobby line, the share card,
     * and now this.
     */
    const { run } = harness()
    const out = text((await run('reply which of these', { room: 'feed' })).lines)

    expect(out).not.toContain('nothing in feed')
    expect(out).toContain('the number needs the name')
  })
})

describe('inside a post, the number still means a reply', () => {
  const IN_POST: Location = { room: 'music', postId: 12 }

  it('answers reply 2, exactly as it did before', async () => {
    const { run, written } = harness()
    await run('reply 2 that is the bit i meant', IN_POST)
    expect(written).toEqual([
      { room: 'music', postNo: 12, body: 'that is the bit i meant', toReply: 2 },
    ])
  })

  it('and an address still reaches a different post from in here', async () => {
    const { run, written } = harness()
    await run('reply poker/3 deal me in', IN_POST)
    expect(written).toEqual([{ room: 'poker', postNo: 3, body: 'deal me in', toReply: undefined }])
  })

  it('refuses a reply number the thread does not have', async () => {
    /*
     * `reply 99 x` used to send. The database drops a pointer that names
     * nothing rather than refusing, so the answer landed — and the confirmation
     * printed `→ 99` over it, a receipt for a link that was never stored, which
     * nothing later contradicts.
     */
    const { run, written } = harness()
    const out = text((await run('reply 99 that one', IN_POST)).lines)

    expect(written).toEqual([])
    expect(out).toContain('no reply 99 here')
    expect(out).toContain('1 to 2')
  })

  it('and zero, which nothing is ever numbered', async () => {
    const { run, written } = harness()
    await run('reply 0 that one', IN_POST)
    expect(written).toEqual([])
  })

  it('says so plainly in a thread with no answers yet', async () => {
    // Aiming at reply 2 where there are none is a different mistake from
    // aiming past the end, and "they run 1 to undefined" is not a sentence.
    const { run, written } = harness()
    const out = text((await run('reply 2 hello', { room: 'poker', postId: 3 })).lines)

    expect(written).toEqual([])
    expect(out).toContain('nothing to answer here yet')
  })

  it('still posts the word when a number has nothing after it', async () => {
    // `reply 2` in a thread is somebody who has not finished typing, and the
    // handler has always posted it as the word "2". Changed by accident, that
    // would be a silent behaviour swap in the commonest place `reply` is used.
    const { run, written } = harness()
    await run('reply 2', IN_POST)
    expect(written).toEqual([{ room: 'music', postNo: 12, body: '2', toReply: undefined }])
  })
})

describe('a number on somebody’s page is a post on their wall', () => {
  it('answers it, the same branch go takes', async () => {
    const { run, written } = harness()
    await run('reply 2 mine are warped too', { person: 'marisol' })
    expect(written).toEqual([
      { room: '~marisol', postNo: 2, body: 'mine are warped too', toReply: undefined },
    ])
  })

  it('says so in their words when their wall has nothing on it', async () => {
    /*
     * A wall is a room everywhere in this codebase, and this is the one place
     * that equivalence leaks out: "there's no room called ~tuck" invites
     * somebody to check their spelling of a thing they never typed.
     */
    const { run, written } = harness()
    const out = text((await run('reply 1 hello', { person: 'tuck' })).lines)

    expect(written).toEqual([])
    expect(out).toContain('nothing on tuck’s wall')
    expect(out).not.toContain('no room called')
  })
})

describe('say never takes an aim', () => {
  it('posts the number as the first word, wherever it is typed', async () => {
    /*
     * The asymmetry that makes `reply` predictable. `say` is content and
     * nothing else; a verb that sometimes swallows its first word is a verb
     * nobody can trust with a sentence that starts with a number.
     */
    const { run, posted } = harness()
    await run('say 7 records turned up today', IN_MUSIC)
    expect(posted).toEqual([{ room: 'music', body: '7 records turned up today' }])
  })

  it('and does not read an address either', async () => {
    const { run, posted } = harness()
    await run('say music/12 is worth reading', IN_POKER)
    expect(posted).toEqual([{ room: 'poker', body: 'music/12 is worth reading' }])
  })
})

describe('the aim survives signing up', () => {
  it('still answers the post you named, two questions later', async () => {
    /*
     * §3.9 holds the sentence across the name and address questions, and where
     * it was aimed has to be held with it. Dropped, the reply would land in
     * whatever room the person happened to be standing in — silently, at the
     * one moment the site promises nothing typed is lost.
     */
    const { run, written, session } = harness(null)

    await run('reply music/12 this is what i think', IN_POKER)
    expect(written).toEqual([])
    expect(session.isAsking()).toBe(true)

    await run('newcomer', IN_POKER)
    const done = await run('newcomer@example.org', IN_POKER)

    expect(written).toEqual([
      { room: 'music', postNo: 12, body: 'this is what i think', toReply: undefined },
    ])
    // And it still says where it went, which is the only place that is said.
    expect(text(done.lines)).toContain('music/12')
  })

  it('does not ask for a name for a post that is not there', async () => {
    // Collecting a name and an email address in exchange for a sentence that
    // is then refused is §3.9's promise turned into a trap.
    const { run, session } = harness(null)
    const out = text((await run('reply music/999 hello', IN_POKER)).lines)

    expect(session.isAsking()).toBe(false)
    expect(out).toContain('there’s nothing at music/999')
  })
})

describe('the spelling that was asked for', () => {
  it('hands back the same line with the slash fixed', async () => {
    /*
     * `reply/5 your reply here` is how the feature was described, and it is the
     * one spelling it cannot have. A "did you mean" is useless here — the verb
     * and the number are both right and one character is wrong — so the answer
     * is their own line, corrected, ready to run.
     */
    const { run } = harness()
    const out = text((await run('reply/7 the same thing happens to me', IN_MUSIC)).lines)
    expect(out).toContain('reply 7 the same thing happens to me')
  })

  it('says nothing about a slash when the word in front is not a verb', async () => {
    // `24/7 is when` typed at the prompt is a typo of nothing. Guessing a verb
    // out of it would invent an instruction.
    const { run } = harness()
    const out = text((await run('24/7 is when the game runs', IN_MUSIC)).lines)
    expect(out).not.toContain('after a space')
  })
})

describe('the aim is not part of what was said', () => {
  it('puts an address in the quiet half, with the verb', async () => {
    // Left in the bright half it reads as a link somebody typed on purpose,
    // rather than the addressing it is.
    const line = echoOf('reply music/12 i had that record too', 'ryan:poker$')
    expect(line.prefix).toBe('ryan:poker$ reply music/12 ')
    expect(line.text).toBe('i had that record too')
  })

  it('reads back as exactly what was typed, in order', () => {
    const line = echoOf('reply music/12 i had that record too', 'ryan:poker$')
    expect(`${line.prefix ?? ''}${line.text}`).toBe(
      'ryan:poker$ reply music/12 i had that record too',
    )
  })

  it('leaves an address alone in say, which takes no aim', () => {
    const line = echoOf('say music/12 is worth reading', 'ryan:poker$')
    expect(line.prefix).toBe('ryan:poker$ say ')
    expect(line.text).toBe('music/12 is worth reading')
  })
})
