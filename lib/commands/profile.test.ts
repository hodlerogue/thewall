import { describe, expect, it } from 'vitest'
import { CHIP_SETS, COMMANDS, findCommand } from '@/lib/commands/registry'
import { chipsForContext, createRunner } from '@/lib/commands/run'
import { fixtureEnv } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Context, Line, Location } from '@/lib/shell/types'

/**
 * §3.10 — a profile is a view, not a place.
 *
 * The doc's most emphatic architectural warning is that a space which absorbs
 * activity "deletes the geography that makes this feel like a place". A
 * personal wall is that trap in a different hat, so the property under test is
 * not that profiles render — it is that nothing about them is postable, and
 * that every post shown on one still carries the room it lives in.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')

function harness() {
  const posted: { room: string; body: string }[] = []

  const api: SignupApi = {
    async checkName(name) {
      return { available: true, alternates: [] }
    },
    async create(name) {
      return { ok: true as const, name }
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
    async reply() {},
  }

  // Already named, so a refusal to post cannot be mistaken for the signup ask.
  const session = new Session(api, writer, 'jameson')
  return { run: createRunner(fixtureEnv(), ['commons'], session), posted }
}

const AT: Record<string, Location> = {
  lobby: {},
  room: { room: 'music' },
  post: { room: 'music', postId: 12 },
  person: { person: 'marisol' },
}

describe('reaching somebody', () => {
  it('opens from a room, from the lobby and from inside a post', async () => {
    for (const [where, at] of Object.entries(AT)) {
      if (where === 'person') continue
      const { run } = harness()
      const result = await run('go ~marisol', at)
      expect(result.location, where).toEqual({ person: 'marisol' })
      expect(text(result.lines), where).toContain('marisol')
    }
  })

  it('says when there is no such person, and points at a real one', async () => {
    const { run } = harness()

    // A near miss teaches the fix, the same way a mistyped room does (§3.7).
    expect(text((await run('go ~marisl', AT.room)).lines)).toContain('did you mean ~marisol?')

    const stranger = text((await run('go ~qqqqqqq', AT.room)).lines)
    expect(stranger).toContain('there’s no one called qqqqqqq')
    expect(stranger).toContain('try: who')
  })

  it('teaches the tilde when a name is typed as though it were a room', async () => {
    const { run } = harness()
    const out = text((await run('go marisol', AT.lobby)).lines)
    expect(out).toContain('there’s no room called marisol')
    expect(out).toContain('go ~marisol')
  })

  it('shows who they are and where everything they said actually lives', async () => {
    const { run } = harness()
    const out = text((await run('go ~jameson', AT.lobby)).lines)

    expect(out).toContain('arrived')
    expect(out).toMatch(/verified|no key followed yet/)
    // Every post carries its room/id, so the page is a set of doors back in.
    expect(out).toContain('music/12')
    expect(out).toContain('poker/2')
    // And nothing from commons, which has no addresses to walk to (§3.10).
    expect(out).not.toContain('commons/')
  })

  it('is somewhere you can look again, and leave from', async () => {
    const { run } = harness()
    expect(text((await run('look', AT.person)).lines)).toContain('kitchen/8')
    expect((await run('leave', AT.person)).location).toEqual({})
  })
})

describe('nothing on a profile is postable', () => {
  it('refuses say by naming the fix, not by failing (§3.7)', async () => {
    const { run, posted } = harness()
    const out = text((await run('say hello there', AT.person)).lines)

    expect(out).toContain('you have to be in a room first')
    expect(out).toContain('try: go ')
    expect(posted).toHaveLength(0)
  })

  it('keeps say out of the palette, so it never reads like a wall', () => {
    expect(CHIP_SETS.person).not.toContain('say')
    expect(chipsForContext('person').map((chip) => chip.verb)).not.toContain('say')
  })

  it('has no post numbers of its own', async () => {
    const { run } = harness()
    const out = text((await run('go 12', AT.person)).lines)
    expect(out).toContain('post numbers only work inside a room')
  })
})

describe('a profile is a filter, not a container', () => {
  it('makes find mean "what they said" without naming them again', async () => {
    const { run } = harness()
    const out = text((await run('find records', AT.person)).lines)
    // marisol never said this; jameson did, in music.
    expect(out).toContain('nothing said about records')

    const hers = text((await run('find tomatoes', AT.person)).lines)
    expect(hers).toContain('kitchen/8')
  })

  it('lets --by override where you are standing', async () => {
    const { run } = harness()
    const out = text((await run('find --by=jameson records', AT.person)).lines)
    expect(out).toContain('music/12')
  })
})

describe('the palette can never name a command you cannot run', () => {
  it('holds for every context, including the new one', () => {
    for (const context of Object.keys(CHIP_SETS) as Context[]) {
      for (const verb of CHIP_SETS[context]) {
        const command = findCommand(verb)
        expect(command, `${context}/${verb}`).toBeDefined()
        expect(command!.contexts, `${context}/${verb}`).toContain(context)
        expect(command!.hidden, `${context}/${verb}`).toBeFalsy()
      }
    }
  })

  it('leaves say valid exactly where contributing is (§3.3)', () => {
    const say = COMMANDS.find((c) => c.verb === 'say')!
    expect([...say.contexts].sort()).toEqual(['commons', 'post', 'room'])
  })
})
