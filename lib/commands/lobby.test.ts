import { describe, expect, it } from 'vitest'
import { findCommand } from '@/lib/commands/registry'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv } from '@/lib/shell/env'
import { ROOMS } from '@/lib/shell/fixtures'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Room } from '@/lib/shell/model'
import type { Line, Location } from '@/lib/shell/types'

/**
 * Getting to the lobby by the words people actually try.
 *
 * Reported as "i'm having trouble getting to thewall homepage". From inside
 * commons, every natural way of asking failed:
 *
 *     go lobby   → there's no room called lobby. try: look
 *     lobby      → i don't know "lobby"
 *     cd /       → there's no room called /
 *     home       → your browser's menu will have "install"…
 *
 * Only `leave` worked, and from inside a post that goes back one step, to the
 * room, rather than to the top.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')

function harness(rooms: Room[] = [...ROOMS]) {
  const env = fixtureEnv(rooms)
  return { run: createRunner(env, ['commons'], new Session({} as SignupApi, {} as Writer, 'ryan')) }
}

const deepInAPost = { room: 'music', postId: 12 } as Location

describe('the lobby, by the words people try', () => {
  for (const words of ['lobby', 'home', 'go lobby', 'cd /', 'go /']) {
    it(`${words} goes there, from inside a post`, async () => {
      const { run } = harness()
      const result = await run(words, deepInAPost)

      expect(result.location).toEqual({})
      expect(text(result.lines)).toContain('music')
      expect(text(result.lines)).toContain('kitchen')
    })
  }

  it('home is no longer install', () => {
    expect(findCommand('home')?.verb).toBe('lobby')
    // The other ways of asking for install still ask for install.
    expect(findCommand('homescreen')?.verb).toBe('install')
    expect(findCommand('app')?.verb).toBe('install')
  })

  it('go home points at the lobby when nobody has made a room called home', async () => {
    const { run } = harness()
    const out = text((await run('go home', { room: 'commons' } as Location)).lines)
    expect(out).toContain('the lobby lists every room')
    expect(out).toContain('try: lobby')
  })

  it('but a room somebody made called home still wins', async () => {
    // `home` is not a reserved name, so somebody can make it, and `go home`
    // must then take them there rather than to the lobby.
    const home: Room = { slug: 'home', gloss: 'where the heart is', ephemeral: false, posts: [] }
    const { run } = harness([...ROOMS, home])
    const result = await run('go home', { room: 'commons' } as Location)
    expect(result.location).toEqual({ room: 'home' })
  })

  it('and leave still goes back one step from a post, which is a different thing', async () => {
    const { run } = harness()
    const result = await run('leave', deepInAPost)
    expect(result.location).toEqual({ room: 'music' })
  })
})
