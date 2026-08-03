import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { suggestAlternates, validateName } from '@/lib/auth/names'
import { fixtureEnv } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')

function harness(options: { taken?: string[]; failCreate?: string } = {}) {
  const taken = new Set(options.taken ?? ['jameson'])
  const posted: { room: string; body: string }[] = []
  const replied: { room: string; postNo: number; body: string }[] = []

  const api: SignupApi = {
    async checkName(name) {
      const available = !taken.has(name)
      return { available, alternates: available ? [] : suggestAlternates(name, taken) }
    },
    async create(name) {
      if (options.failCreate) return { ok: false as const, reason: options.failCreate }
      return { ok: true as const, name }
    },
  }

  const writer: Writer = {
    async post(room, body) {
      posted.push({ room, body })
      return 42
    },
    async reply(room, postNo, body) {
      replied.push({ room, postNo, body })
    },
  }

  const session = new Session(api, writer)
  const run = createRunner(fixtureEnv(), ['commons'], session)

  return { session, run, posted, replied }
}

describe('§3.9 — signup is deferred to first contribution', () => {
  it('lets you read everything without ever asking who you are', async () => {
    const { run, session } = harness()
    const at: Location = { room: 'music' }

    for (const command of ['look', 'go 12', 'leave', 'who', 'help']) {
      const out = text((await run(command, at)).lines)
      expect(out.toLowerCase(), command).not.toMatch(/what do you want to be called/)
    }
    expect(session.name()).toBeNull()
  })

  it('asks for a name only when you first try to say something', async () => {
    const { run, session } = harness()
    const out = text((await run('say the AC is out again', { room: 'music' })).lines)

    expect(out).toMatch(/what do you want to be called\?/)
    expect(session.isAsking()).toBe(true)
  })

  it('posts the held sentence automatically — you never re-type it', async () => {
    const { run, posted, session } = harness()
    const at: Location = { room: 'music' }
    const sentence = 'found my dad’s records in the garage'

    await run(`say ${sentence}`, at)
    await run('newcomer', at)
    const done = await run('newcomer@example.com', at)

    expect(posted).toEqual([{ room: 'music', body: sentence }])
    expect(text(done.lines)).toMatch(/now — the thing you were trying to say/)
    // The prompt stops saying `guest` in the same breath.
    expect(done.identity).toBe('newcomer')
    expect(session.name()).toBe('newcomer')
    expect(session.isAsking()).toBe(false)
  })

  it('sends the held reply to the post you were standing in', async () => {
    const { run, replied, posted } = harness()
    const at: Location = { room: 'music', postId: 12 }

    await run('say warped ones still play', at)
    await run('newcomer', at)
    await run('newcomer@example.com', at)

    expect(replied).toEqual([{ room: 'music', postNo: 12, body: 'warped ones still play' }])
    expect(posted).toEqual([])
  })

  it('cancel returns to reading with nothing lost and nothing sent', async () => {
    const { run, posted, session } = harness()
    const at: Location = { room: 'music' }

    await run('say something i thought better of', at)
    const out = text((await run('cancel', at)).lines)

    expect(out).toMatch(/nothing sent/)
    expect(posted).toEqual([])
    expect(session.isAsking()).toBe(false)
    expect(session.name()).toBeNull()

    // And the shell is a shell again.
    expect(text((await run('look', at)).lines)).toMatch(/records|bass player/)
  })

  it('cancels from the email question too', async () => {
    const { run, posted } = harness()
    const at: Location = { room: 'music' }
    await run('say hello', at)
    await run('newcomer', at)
    const out = text((await run('cancel', at)).lines)
    expect(out).toMatch(/nothing sent/)
    expect(posted).toEqual([])
  })

  it('treats answers as answers, not commands', async () => {
    const { run, session } = harness()
    const at: Location = { room: 'music' }
    await run('say hello', at)

    // `read` is an alias for `go`. Mid-signup it has to be a name.
    const out = text((await run('read', at)).lines)
    expect(out).not.toMatch(/i don’t know/)
    expect(session.isAsking()).toBe(true)
    // It was accepted as a name and moved on to the second question.
    expect(out).toMatch(/where should i send your key\?/)
  })

  it('never asks for a password — a prompt cannot mask input (§9)', async () => {
    const { run } = harness()
    const at: Location = { room: 'music' }
    const first = text((await run('say hello', at)).lines)
    const second = text((await run('newcomer', at)).lines)
    const all = `${first}\n${second}`.toLowerCase()

    // It may mention passwords, but only to say there aren't any.
    expect(all).not.toMatch(/(choose|enter|pick|type|set) a password|password\?/)
    expect(second).toMatch(/no password/)
  })

  it('suggests alternates when the name is taken, rather than just refusing', async () => {
    const { run } = harness({ taken: ['marisol'] })
    const at: Location = { room: 'music' }
    await run('say hello', at)
    const out = text((await run('marisol', at)).lines)

    expect(out).toMatch(/marisol is taken/)
    expect(out).toMatch(/are free/)
  })

  it('explains a malformed name and offers one that works', async () => {
    const { run } = harness()
    const at: Location = { room: 'music' }
    await run('say hello', at)

    const out = text((await run('Mari Sol!', at)).lines)
    expect(out).toMatch(/letters, numbers and underscores only/)
    expect(out).toMatch(/mari_sol would work/)
  })

  it('does not accept something that is not an email', async () => {
    const { run, posted } = harness()
    const at: Location = { room: 'music' }
    await run('say hello', at)
    await run('newcomer', at)

    const out = text((await run('not-an-email', at)).lines)
    expect(out).toMatch(/doesn’t look like an email/)
    expect(posted).toEqual([])
  })

  it('keeps the held sentence when the account cannot be created', async () => {
    const { run, posted } = harness({ failCreate: 'that email is already here.' })
    const at: Location = { room: 'music' }
    await run('say hello', at)
    await run('newcomer', at)

    const out = text((await run('newcomer@example.com', at)).lines)
    expect(out).toMatch(/already here/)
    expect(posted).toEqual([])
  })

  it('goes straight through once you have a name', async () => {
    const { run, posted, session } = harness()
    const at: Location = { room: 'music' }

    await run('say first', at)
    await run('newcomer', at)
    await run('newcomer@example.com', at)
    posted.length = 0

    const out = text((await run('say second', at)).lines)
    expect(out).toMatch(/said — it’s post 42/)
    expect(posted).toEqual([{ room: 'music', body: 'second' }])
    expect(session.isAsking()).toBe(false)
  })

  it('says a guest is not on the list, and why', async () => {
    const { run } = harness()
    const out = text((await run('who', { room: 'music' })).lines)
    expect(out).toMatch(/say something and you’ll be on the list/)
  })
})

describe('name rules match the schema', () => {
  it('accepts what the profiles_name_shape check accepts', () => {
    for (const name of ['ren', 'marisol', 'dev_2', 'a1']) {
      expect(validateName(name), name).toMatchObject({ ok: true })
    }
  })

  it('rejects what the database would reject', () => {
    for (const name of ['a', '', 'x'.repeat(21), 'has space', 'Ünicode', 'dash-name']) {
      expect(validateName(name).ok, name).toBe(false)
    }
  })

  it('lowercases, because names are case-insensitive in the schema', () => {
    expect(validateName('Marisol')).toMatchObject({ ok: true, name: 'marisol' })
  })

  it('keeps reserved names out of reach', () => {
    for (const name of ['guest', 'admin', 'thewall', 'lobby']) {
      expect(validateName(name).ok, name).toBe(false)
    }
  })

  it('only ever suggests names that would themselves be valid', () => {
    const taken = new Set(['ren', 'ren_', 'ren1'])
    for (const suggestion of suggestAlternates('ren', taken)) {
      expect(validateName(suggestion), suggestion).toMatchObject({ ok: true })
      expect(taken.has(suggestion)).toBe(false)
    }
  })

  it('does not suggest anything longer than the column allows', () => {
    const long = 'x'.repeat(20)
    for (const suggestion of suggestAlternates(long, new Set())) {
      expect(suggestion.length).toBeLessThanOrEqual(20)
    }
  })
})
