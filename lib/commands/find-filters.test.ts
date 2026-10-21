import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'

/*
 * What `find` says about a filter it could not use.
 *
 * Each of these used to answer a different question from the one asked —
 * mostly "nothing said about records", which reads as a quiet week when the
 * real story was a person or room that does not exist, a flag in the wrong
 * place, or a value after a space instead of an =.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')
const LOBBY: Location = {}
const MUSIC: Location = { room: 'music' }

async function find(input: string, at: Location = LOBBY) {
  const session = new Session({} as SignupApi, {} as Writer, 'tester')
  return text((await createRunner(fixtureEnv(), ['commons'], session)(input, at)).lines)
}

describe('a filter naming nothing says so', () => {
  it('a person', async () => {
    expect(await find('find --by=nobody records')).toBe('no one here is called nobody.')
  })

  it('a room', async () => {
    expect(await find('find --room=nowhere records')).toBe(
      'there’s no room called nowhere. try: find --rooms nowhere',
    )
  })

  it('but a real one with nothing in it is still just nothing', async () => {
    expect(await find('find --room=poker tomatoes')).toBe('nothing said about tomatoes in poker.')
  })
})

describe('a flag written the way a terminal would take it', () => {
  it('with a space instead of an =', async () => {
    expect(await find('find records --since 3d')).toBe('--since takes its value after an =. try: --since=3d')
    expect(await find('find --by marisol')).toBe('--by takes its value after an =. try: --by=marisol')
  })

  it('with one dash', async () => {
    expect(await find('find -r records')).toMatch(/^flags take two dashes here/)
  })

  it('a post filter beside --rooms', async () => {
    expect(await find('find --rooms --since=1d')).toMatch(/^--since is for posts/)
  })

  it('a limit that is not a number', async () => {
    expect(await find('find --limit=abc x')).toBe('--limit takes a whole number from 1 to 100. try: --limit=5')
  })
})

describe('an empty search says where it looked', () => {
  it('and that standing in a room was a filter', async () => {
    expect(await find('find tomatoes', MUSIC)).toBe(
      'nothing said about tomatoes in music.\nthat was just music. leave, then find again, to look everywhere.',
    )
  })

  it('takes a name written as an address', async () => {
    expect(await find('find --by=~marisol')).toMatch(/marisol/)
  })
})
