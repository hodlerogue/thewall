import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { parse } from '@/lib/commands/parse'
import { fixtureEnv } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'

/**
 * `rooms` shows the rooms.
 *
 * Found by walking the demo as somebody arriving for the first time. `rooms`
 * was an alias of `look`, and `look` shows where you are standing — so typing
 * the most natural word for "what else is here" from inside commons printed
 * commons again, verbatim, underneath a line saying you had asked for it. In
 * the lobby the alias happened to be right, which is why it lasted.
 *
 * Separate from `rooms.test.ts`, which is about §4.2 and whether making rooms
 * can turn the lobby into a directory. This is about the word.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')

function harness() {
  const env = fixtureEnv()
  const api = {} as SignupApi
  const writer = {} as Writer
  return { run: createRunner(env, ['commons'], new Session(api, writer, 'ryan')) }
}

describe('rooms, from wherever you are standing', () => {
  it('is its own verb, not a word that means look', () => {
    expect(parse('rooms')?.command?.verb).toBe('rooms')
  })

  it('lists the rooms from inside a room', async () => {
    const { run } = harness()
    const out = text((await run('rooms', { room: 'commons' } as Location)).lines)

    // Several rooms, which is what the word asks for.
    expect(out).toContain('music')
    expect(out).toContain('poker')
    expect(out).toContain('kitchen')

    /*
     * And not the room it was typed in. The listing does preview each room's
     * newest post, so commons' own line appears in it — what must not appear is
     * the *room view* of commons, which is what the alias used to print.
     */
    expect(out).not.toContain('commons keeps nothing')
  })

  it('lists them from inside a post, without losing the post', async () => {
    const { run } = harness()
    const result = await run('rooms', { room: 'music', postId: 12 } as Location)

    expect(text(result.lines)).toContain('kitchen')
    // It answers a question rather than taking a journey: somebody wondering
    // what else is going on mid-thread should not lose the thread to find out.
    expect(result.location).toBeUndefined()
  })

  it('lists them in the lobby too, where it always did', async () => {
    const { run } = harness()
    expect(text((await run('rooms', {} as Location)).lines)).toContain('music')
  })

  it('says how to make one, the same way the lobby does', async () => {
    const { run } = harness()
    expect(text((await run('rooms', { room: 'music' } as Location)).lines)).toContain('make')
  })

  it('explains itself under what', async () => {
    // Folded out of the glossary (§3.6 caps the first group at ten), so `what`
    // is where it is documented and the arrival line is where it is named.
    const { run } = harness()
    const out = text((await run('what rooms', { room: 'music' } as Location)).lines)
    expect(out).toContain('without moving you')
  })
})
