import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'

/*
 * QA: `login`, then `logout` from habit, answered "no one here is called
 * logout" — the question ate the command. And `cancel`, with nothing open,
 * answered `i don't know "cancel"`.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')
const at: Location = { room: 'music' }

function harness() {
  const looked: string[] = []
  const api = {
    async login(name: string) {
      looked.push(name)
      return name === 'ryan' || name === 'look'
        ? { ok: true as const, name, note: `a key is on its way to ${name}’s address.`, codeSent: false }
        : { ok: false as const, reason: `no one here is called ${name}.` }
    },
  } as unknown as SignupApi
  const session = new Session(api, {} as Writer, null)
  const run = createRunner(fixtureEnv(), ['commons'], session)
  return { run, session, looked }
}

describe('a command typed at the login question', () => {
  it('is checked before it is looked up as a name', async () => {
    const { run, session, looked } = harness()
    expect(text((await run('login', at)).lines)).toMatch(/what name do you go by here\?/)

    const out = text((await run('logout', at)).lines)
    expect(out).toMatch(/“logout” is something you can type, too/)
    expect(out).not.toMatch(/no one here is called/)
    expect(looked).toEqual([])
    expect(session.isAsking()).toBe(true)
  })

  it('n asks for the name again, and then a name works', async () => {
    const { run, looked } = harness()
    await run('login', at)
    await run('logout', at)
    expect(text((await run('n', at)).lines)).toMatch(/what name do you go by here\?/)
    expect(text((await run('ryan', at)).lines)).toMatch(/on its way to ryan/)
    expect(looked).toEqual(['ryan'])
  })

  it('y looks it up after all — names can be command words', async () => {
    const { run, looked } = harness()
    await run('login', at)
    await run('look', at)
    expect(text((await run('maybe', at)).lines)).toMatch(/y or n\./)
    expect(text((await run('y', at)).lines)).toMatch(/on its way to look/)
    expect(looked).toEqual(['look'])
  })

  it('cancel stops logging in', async () => {
    const { run, session, looked } = harness()
    await run('login', at)
    await run('logout', at)
    expect(text((await run('cancel', at)).lines)).toMatch(/no problem/)
    expect(session.isAsking()).toBe(false)
    expect(looked).toEqual([])
  })

  it('leaves an ordinary name alone', async () => {
    const { run, looked } = harness()
    await run('login', at)
    expect(text((await run('ryan', at)).lines)).toMatch(/on its way to ryan/)
    expect(looked).toEqual(['ryan'])
  })
})

describe('cancel with nothing to cancel', () => {
  it('says so, rather than not knowing the word', async () => {
    const { run } = harness()
    for (const word of ['cancel', 'nevermind', 'stop']) {
      const out = text((await run(word, at)).lines)
      expect(out, word).toBe('nothing to cancel.')
    }
  })
})
