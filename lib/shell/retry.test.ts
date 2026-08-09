import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'

/**
 * What comes back when a write fails, and whether it can be sent.
 *
 * §3.9's proudest mechanic is that you never re-type your sentence. `retry`
 * puts the words back in the prompt, which looked like it honoured that and did
 * not: the handlers return their *argument*, and the argument on its own is not
 * a command. `say four pounds of tomatoes` failing put `four pounds of
 * tomatoes` in the box, and pressing Enter — which is the only thing anybody
 * does next — answered `i don't know "four"` and took the sentence with it.
 *
 * So the test is not "are the words there". It is **type it again and see what
 * happens**, which is CHANGING-IT's oldest rule about suggested fixes applied
 * to the one path where the suggestion is silent.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')
const IN_ROOM: Location = { room: 'music' }

function harness(name: string | null = 'ryan') {
  const sent: { room: string; postNo?: number; body: string; toReply?: number }[] = []
  /** Fails until it is told to stop, which is what a network blip looks like. */
  let broken = true

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
      if (broken) throw new Error('that didn’t send. try again?')
      sent.push({ room, body })
      return 42
    },
    async reply(room, postNo, body, toReply) {
      if (broken) throw new Error('that didn’t send. try again?')
      sent.push({ room, postNo, body, toReply })
      return 1
    },
    async rename(n) {
      return { ok: true as const, name: n }
    },
  }

  const session = new Session(api, writer, name)
  return {
    sent,
    session,
    run: createRunner(fixtureEnv(), ['commons'], session),
    mend: () => {
      broken = false
    },
  }
}

describe('the words come back as a line that runs', () => {
  it('for say, with the verb it needs', async () => {
    const { run, sent, mend } = harness()
    const failed = await run('say four pounds of tomatoes', IN_ROOM)

    expect(failed.retry).toBe('say four pounds of tomatoes')

    // The actual test: press Enter on what was handed back.
    mend()
    await run(failed.retry!, IN_ROOM)
    expect(sent).toEqual([{ room: 'music', body: 'four pounds of tomatoes' }])
  })

  it('for a reply aimed at a number, keeping the aim', async () => {
    const { run, sent, mend } = harness()
    const failed = await run('reply 2 that is the bit i meant', {
      room: 'music',
      postId: 12,
    } as Location)

    mend()
    await run(failed.retry!, { room: 'music', postId: 12 } as Location)
    expect(sent).toEqual([
      { room: 'music', postNo: 12, body: 'that is the bit i meant', toReply: 2 },
    ])
  })

  it('for a reply aimed at a whole address, from where it was typed', async () => {
    // The one that would go somewhere else entirely if the address were
    // dropped: re-sent from poker, it still has to land in music.
    const { run, sent, mend } = harness()
    const failed = await run('reply music/12 i had that record too', { room: 'poker' })

    mend()
    await run(failed.retry!, { room: 'poker' })
    expect(sent).toEqual([
      { room: 'music', postNo: 12, body: 'i had that record too', toReply: undefined },
    ])
  })

  it('echoes back the alias somebody typed, not the verb it resolves to', async () => {
    // `post` is an alias of `say`. Correcting it in the prompt would be the
    // site rewriting somebody's line while handing it back to them.
    const { run } = harness()
    expect((await run('post something', IN_ROOM)).retry).toBe('post something')
  })

  it('and says nothing when nothing failed', async () => {
    const { run, mend } = harness()
    mend()
    expect((await run('say it worked', IN_ROOM)).retry).toBeUndefined()
  })
})

describe('the held sentence, when it fails at the moment the account is made', () => {
  it('comes back sendable, with the verb and the aim', async () => {
    /*
     * The worst moment for this. Two questions have been answered, the account
     * exists, and the sentence that started it all is what fails — so what goes
     * back in the prompt is the only copy left.
     */
    const { run, sent, session, mend } = harness(null)

    await run('reply music/12 this is what i think', { room: 'poker' })
    await run('newcomer', { room: 'poker' })
    const done = await run('newcomer@example.org', { room: 'poker' })

    expect(session.name()).toBe('newcomer')
    expect(sent).toEqual([])
    expect(done.retry).toBe('reply music/12 this is what i think')

    mend()
    await run(done.retry!, { room: 'poker' })
    expect(sent).toEqual([
      { room: 'music', postNo: 12, body: 'this is what i think', toReply: undefined },
    ])
  })

  it('spells it as say when it was going to a room', async () => {
    const { run, sent, mend } = harness(null)

    await run('say four pounds of tomatoes', IN_ROOM)
    await run('newcomer', IN_ROOM)
    const done = await run('newcomer@example.org', IN_ROOM)

    expect(done.retry).toBe('say four pounds of tomatoes')
    mend()
    await run(done.retry!, IN_ROOM)
    expect(sent).toEqual([{ room: 'music', body: 'four pounds of tomatoes' }])
  })
})

describe('a longer post that fails stays a draft', () => {
  it('is not handed back through the prompt, which would flatten it', async () => {
    /*
     * The prompt is a single-line `<input>`, and assigning a value with
     * newlines in it strips them. So handing a failed draft back that way
     * destroyed every paragraph break — the one thing `write` exists to make
     * possible — at the moment the person most needed it intact.
     */
    const { run, session } = harness()

    await run('write', IN_ROOM)
    await run('the first paragraph', IN_ROOM)
    await run('', IN_ROOM)
    await run('and the second', IN_ROOM)
    const failed = await run('.', IN_ROOM)

    expect(failed.retry).toBeUndefined()
    expect(text(failed.lines)).toContain('type a dot to try again')

    // Still a draft, with everything in it: the mode is on and the count is
    // the whole post rather than a line of it.
    expect(session.isAsking()).toBe(true)
    expect(failed.composing).toEqual({ lines: 3, chars: 35 })
  })

  it('and sends whole, breaks and all, once it can', async () => {
    const { run, sent, mend } = harness()

    await run('write', IN_ROOM)
    await run('the first paragraph', IN_ROOM)
    await run('', IN_ROOM)
    await run('and the second', IN_ROOM)
    await run('.', IN_ROOM)

    mend()
    await run('.', IN_ROOM)
    expect(sent).toEqual([{ room: 'music', body: 'the first paragraph\n\nand the second' }])
  })

  it('and cancel still throws it away, so the draft is not a trap', async () => {
    // A draft that cannot be abandoned would be worse than one that is lost.
    const { run, sent, session } = harness()

    await run('write', IN_ROOM)
    await run('something', IN_ROOM)
    await run('.', IN_ROOM)
    const out = text((await run('cancel', IN_ROOM)).lines)

    expect(out).toContain('thrown away')
    expect(session.isAsking()).toBe(false)
    expect(sent).toEqual([])
  })
})
