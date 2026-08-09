import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv, type Env } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import { renderRoomList } from '@/lib/shell/render'
import type { Room } from '@/lib/shell/model'
import type { Line, Location } from '@/lib/shell/types'

/**
 * A post with paragraphs in it.
 *
 * The gap was smaller than it looked and was never about length — the cap was
 * already two thousand characters. The prompt is a single-line `<input>`, so
 * there was no way to type a line break: a long post had to be one unbroken
 * block, and pasting one in flattens it.
 *
 * What this deliberately is *not* is a second kind of post. The idea that
 * started it had a subject field and a 280-character floor to qualify; the
 * floor was dropped because all twenty-one posts the site ships as its own
 * example of good content are under it, the longest by half. What comes out of
 * `write` is an ordinary post at an ordinary address, and no listing, search,
 * feed or moderation lever has to ask which kind a thing is.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')
const IN_ROOM: Location = { room: 'music' }

function harness(name: string | null = 'ryan') {
  const posted: string[] = []
  const rooms: Room[] = [
    { slug: 'music', gloss: 'what you are listening to', ephemeral: false, posts: [] },
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
    async post(_room, body) {
      posted.push(body)
      return posted.length
    },
    async reply() {
      return 1
    },
    async rename(n) {
      return { ok: true as const, name: n }
    },
  }
  const session = new Session(api, writer, name)
  return { run: createRunner(env, ['commons'], session), posted, session }
}

describe('write takes lines until a dot', () => {
  it('keeps the line breaks, which is the whole point', async () => {
    const { run, posted } = harness()
    await run('write', IN_ROOM)
    await run('the first thing i want to say', IN_ROOM)
    await run('', IN_ROOM)
    await run('and the second, after a gap', IN_ROOM)
    await run('.', IN_ROOM)

    expect(posted).toEqual(['the first thing i want to say\n\nand the second, after a gap'])
  })

  it('says nothing between the lines', async () => {
    // The echo above is already the record of what was typed. A word under
    // every line is how a prompt turns into a chat client.
    const { run } = harness()
    await run('write', IN_ROOM)
    expect((await run('a line', IN_ROOM)).lines).toEqual([])
  })

  it('reports how much has been written, so the mode is visible', async () => {
    /*
     * The one state where forgetting you are in it is expensive: every line
     * disappears into a draft, and unlike the signup questions nothing is being
     * asked to remind you.
     */
    const { run } = harness()
    await run('write', IN_ROOM)
    await run('twelve chars', IN_ROOM)

    expect((await run('a second line', IN_ROOM)).composing).toEqual({ lines: 2, chars: 26 })
  })

  it('clears the indicator the moment it is sent', async () => {
    const { run } = harness()
    await run('write', IN_ROOM)
    await run('something', IN_ROOM)
    expect((await run('.', IN_ROOM)).composing).toBeNull()
  })

  it('does not run commands typed into it', async () => {
    // `look` is a real verb, and in here it is a line of prose. Anything else
    // would make a draft impossible to write about this site.
    const { run, posted } = harness()
    await run('write', IN_ROOM)
    await run('look at what happens next', IN_ROOM)
    await run('.', IN_ROOM)

    expect(posted).toEqual(['look at what happens next'])
  })

  it('does not treat login as an escape, which would throw the draft away', async () => {
    /*
     * `login ryan` is an escape from the signup questions on purpose. In here it
     * is a plausible sentence in the middle of a paragraph, and treating it as a
     * command would discard everything written so far — the exact failure this
     * mode exists to make impossible.
     */
    const { run, posted, session } = harness()
    await run('write', IN_ROOM)
    await run('login ryan is what the site told me to type', IN_ROOM)
    await run('.', IN_ROOM)

    expect(posted).toEqual(['login ryan is what the site told me to type'])
    expect(session.isAsking()).toBe(false)
  })

  it('drops trailing blank lines, which are never meant', async () => {
    const { run, posted } = harness()
    await run('write', IN_ROOM)
    await run('the thing', IN_ROOM)
    await run('', IN_ROOM)
    await run('', IN_ROOM)
    await run('.', IN_ROOM)

    expect(posted).toEqual(['the thing'])
  })

  it('sends nothing when nothing was written', async () => {
    const { run, posted } = harness()
    await run('write', IN_ROOM)
    const out = text((await run('.', IN_ROOM)).lines)

    expect(posted).toEqual([])
    expect(out).toContain('nothing written')
  })
})

describe('the ways out', () => {
  it('cancel throws it away, and says so plainly', async () => {
    // This discards work rather than a single sentence, so somebody who typed
    // it by accident is owed the exact truth about what just happened.
    const { run, posted, session } = harness()
    await run('write', IN_ROOM)
    await run('a paragraph i spent time on', IN_ROOM)
    const out = text((await run('cancel', IN_ROOM)).lines)

    expect(posted).toEqual([])
    expect(out).toContain('thrown away')
    expect(session.isAsking()).toBe(false)
  })

  it('refuses the line that would not fit, not the whole draft', async () => {
    /*
     * The database would refuse the commit, and by then the draft is gone and
     * so is the writing. Checking as it is typed means the answer arrives while
     * there is still something to shorten — and the line comes back in the
     * prompt rather than being swallowed.
     */
    const { run, posted } = harness()
    await run('write', IN_ROOM)
    await run('x'.repeat(3990), IN_ROOM)

    const result = await run('y'.repeat(100), IN_ROOM)
    expect(text(result.lines)).toContain('past 4000 characters')
    expect(result.retry).toBe('y'.repeat(100))

    // And what was already written is still there to be sent.
    await run('.', IN_ROOM)
    expect(posted).toEqual(['x'.repeat(3990)])
  })
})

describe('a draft survives signing up', () => {
  it('is posted whole once there is a name', async () => {
    // §3.9 holds a sentence across the two questions. A draft is a sentence as
    // far as that machinery is concerned, and losing a page of writing to a
    // signup question would be the worst version of the bug it exists to stop.
    const { run, posted, session } = harness(null)

    await run('write', IN_ROOM)
    await run('the first paragraph', IN_ROOM)
    await run('', IN_ROOM)
    await run('and the second', IN_ROOM)
    await run('.', IN_ROOM)

    expect(posted).toEqual([])
    expect(session.isAsking()).toBe(true)

    await run('newcomer', IN_ROOM)
    await run('newcomer@example.org', IN_ROOM)

    expect(posted).toEqual(['the first paragraph\n\nand the second'])
  })
})

describe('a listing previews the first line', () => {
  const room = (body: string) => ({
    slug: 'music',
    gloss: 'what you are listening to',
    ephemeral: false,
    curated: true,
    latest: { author: 'ryan', body, createdAt: new Date() },
  })

  it('never lets a newline into a one-line preview', () => {
    /*
     * Every listing shows a slice of a body as a single `Line`, and the
     * scrollback renders `pre-wrap` — so a newline inside that slice really
     * does break the line. One preview would silently become two and a lobby of
     * them would come apart.
     */
    const lines = renderRoomList([room('the subject\n\nand then the argument, at length')])
    for (const line of lines) expect(line.text).not.toContain('\n')
  })

  it('shows the first line, which is the subject if there is one', () => {
    // Nothing was added to the schema for this. Somebody who writes a short
    // opening line and their argument underneath has written a subject and a
    // body, and it falls out of being able to type a line break at all.
    const lines = renderRoomList([room('found my dad’s records\n\nhalf of them are warped')])
    expect(text(lines)).toContain('found my dad’s records…')
    expect(text(lines)).not.toContain('warped')
  })

  it('leaves a one-line body exactly as it was', () => {
    const lines = renderRoomList([room('anyone else awake')])
    expect(text(lines)).toContain('anyone else awake —')
    expect(text(lines)).not.toContain('anyone else awake…')
  })
})

describe('the length limit is one number, stated in five places', () => {
  /*
   * A limit that disagrees with the one enforcing it is how a long piece of
   * writing gets accepted by the prompt and refused by the server — the exact
   * moment §3.9 promises cannot happen, and the most expensive one to hit.
   *
   * So the migration is read, and everything that repeats the number is checked
   * against it. Nothing here restates 4000; change the constraint and this
   * points at whatever else did not follow.
   */
  const migrations = join(__dirname, '..', '..', 'supabase', 'migrations')
  const schema = readdirSync(migrations)
    .sort()
    .map((f) => readFileSync(join(migrations, f), 'utf8'))
    .join('\n')

  // The last one wins, exactly as applying them in order does.
  const declared = [...schema.matchAll(/posts_body_length\s+check \(char_length\(body\) between 1 and (\d+)\)/g)]
  const limit = Number(declared[declared.length - 1][1])

  it('is a real number, so a passing suite means something', () => {
    expect(limit).toBeGreaterThan(100)
  })

  it('agrees with the session, which refuses a line before the draft is lost', () => {
    expect(Session.LIMIT).toBe(limit)
  })

  it('agrees with the sentence the browser shows when the server refuses', () => {
    const friendly = readFileSync(join(__dirname, '..', 'data', 'writer.ts'), 'utf8')
    expect(friendly).toContain(`longer than ${limit} characters`)
  })

  it('agrees with what the prompt will physically accept', () => {
    // A little over, because `reply 999 ` is a prefix a body can follow — but
    // never under, which would truncate the words before they were sent.
    const terminal = readFileSync(
      join(__dirname, '..', '..', 'components', 'Terminal.tsx'),
      'utf8',
    )
    const max = Number(/maxLength=\{(\d+)\}/.exec(terminal)![1])
    expect(max).toBeGreaterThanOrEqual(limit)
    expect(max).toBeLessThan(limit + 100)
  })

  it('agrees with what `what write` tells people', () => {
    const registry = readFileSync(join(__dirname, 'registry.ts'), 'utf8')
    expect(registry).toContain(`the limit is ${limit} characters`)
  })

  it('applies to replies too, since an answer can be as long as the thing', () => {
    const forReplies = [...schema.matchAll(/replies_body_length\s+check \(char_length\(body\) between 1 and (\d+)\)/g)]
    expect(Number(forReplies[forReplies.length - 1][1])).toBe(limit)
  })
})
