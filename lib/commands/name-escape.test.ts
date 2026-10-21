import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'

/*
 * Ways out of the two questions that ask for a name.
 *
 * QA could not find one: `cancel` worked, nothing said so, and typing what you
 * actually meant to do — `go music` — was checked as a name and refused for
 * having a space. Names have no spaces, so a command with something after it
 * cannot be an answer here.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')
const LOBBY: Location = {}
const MUSIC: Location = { room: 'music' }

function guest() {
  const signup = { checkName: async () => ({ available: true, alternates: [] }) } as unknown as SignupApi
  const session = new Session(signup, {} as Writer, null)
  return { session, run: createRunner(fixtureEnv(), ['commons'], session) }
}

describe('the name questions say how to leave', () => {
  it('at signup', async () => {
    const { run } = guest()
    expect(text((await run('say hello', MUSIC)).lines)).toMatch(/what do you want to be called\?\ncancel stops here\./)
  })

  it('at login', async () => {
    const { run } = guest()
    expect(text((await run('login', LOBBY)).lines)).toMatch(/cancel stops here\./)
  })
})

describe('a command with words after it leaves the question and runs', () => {
  it('from signup', async () => {
    const { run, session } = guest()
    await run('say hello', MUSIC)
    expect(session.isAsking()).toBe(true)
    const result = await run('go poker', MUSIC)
    expect(session.isAsking()).toBe(false)
    expect(result.location).toEqual({ room: 'poker' })
    expect(text(result.lines)).toMatch(/^no problem — nothing sent/)
  })

  it('from login', async () => {
    const { run, session } = guest()
    await run('login', LOBBY)
    const result = await run('go music', LOBBY)
    expect(session.isAsking()).toBe(false)
    expect(result.location).toEqual({ room: 'music' })
  })

  it('but a bare command word is still asked about, since it may be a name', async () => {
    const { run, session } = guest()
    await run('say hello', MUSIC)
    const out = text((await run('look', MUSIC)).lines)
    expect(session.isAsking()).toBe(true)
    expect(out).toMatch(/“look” is something you can type, too/)
  })

  it('and a question that is not about a name keeps every word typed at it', async () => {
    // `make` asks what a room is for, and "go somewhere quiet" is a fine answer.
    const owner = new Session({} as SignupApi, {} as Writer, 'tester')
    const maker = createRunner(fixtureEnv(), ['commons'], owner)
    await maker('make quietroom', LOBBY)
    expect(owner.isAsking()).toBe(true)
    await maker('go somewhere quiet', LOBBY)
    // Still the same question — make checks a description that starts with a
    // command word, and that check is the answer being kept, not dropped.
    expect(owner.isAsking()).toBe(true)
    await maker('y', LOBBY)
    expect(owner.isAsking()).toBe(false)
    expect(text((await maker('look', { room: 'quietroom' })).lines)).toMatch(/quietroom is for: go somewhere quiet/)
  })
})
