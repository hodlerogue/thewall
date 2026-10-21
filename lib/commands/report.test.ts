import { describe, expect, it } from 'vitest'
import { findCommand } from '@/lib/commands/registry'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv, type Env, type ReportTarget, type Reported } from '@/lib/shell/env'
import { ROOMS } from '@/lib/shell/fixtures'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'

/**
 * `report` — working out what is being pointed at.
 *
 * Every rule about who may report what, and the threshold that hides it, is in
 * `report_content` and tested in schema.test.sql. What is tested here is the
 * aim: that `report 3` means reply 3 inside a post and post 3 in a room, the
 * same as `reply`, and that the line coming back names exactly what was hit.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')

function harness(outcome: Reported = { ok: true, outcome: 'reported' }, name: string | null = 'ryan') {
  const calls: { target: ReportTarget; why: string }[] = []
  const env: Env = {
    ...fixtureEnv(ROOMS.map((r) => ({ ...r }))),
    async report(target, why) {
      calls.push({ target, why })
      return outcome
    },
  }
  const run = createRunner(env, ['commons'], new Session({} as SignupApi, {} as Writer, name))
  return { run, calls }
}

const room = { room: 'music' } as Location
const post = { room: 'music', postId: 12 } as Location

describe('what report points at', () => {
  it('a number in a room is a post', async () => {
    const { run, calls } = harness()
    const out = text((await run('report 12 spam', room)).lines)
    expect(calls).toEqual([{ target: { room: 'music', post: 12 }, why: 'spam' }])
    expect(out).toContain('music/12 reported')
  })

  it('a number inside a post is a reply, as it is for reply', async () => {
    const { run, calls } = harness()
    const out = text((await run('report 2 rude', post)).lines)
    expect(calls[0].target).toEqual({ room: 'music', post: 12, reply: 2 })
    expect(out).toContain('music/12, reply 2 reported')
  })

  it('post, inside a post, is the post itself', async () => {
    const { run, calls } = harness()
    await run('report post', post)
    expect(calls[0].target).toEqual({ room: 'music', post: 12 })
  })

  it('room is the room you are standing in — the inappropriately named one', async () => {
    const { run, calls } = harness()
    await run('report room offensive name', { room: 'pulsechain' } as Location)
    expect(calls[0]).toEqual({ target: { room: 'pulsechain' }, why: 'offensive name' })
  })

  it('an address works from anywhere, walls included', async () => {
    const { run, calls } = harness()
    await run('report kitchen/3', {} as Location)
    await run('report ~marisol/2 not ok', {} as Location)
    expect(calls.map((c) => c.target)).toEqual([
      { room: 'kitchen', post: 3 },
      { room: '~marisol', post: 2 },
    ])
  })

  it('the reason is optional, and everything after the aim', async () => {
    const { run, calls } = harness()
    await run('report 12', room)
    await run('report 12 this is   several words', room)
    expect(calls.map((c) => c.why)).toEqual(['', 'this is several words'])
  })
})

describe('what report says back', () => {
  it('when it was the report that hid it', async () => {
    const { run } = harness({ ok: true, outcome: 'hidden' })
    expect(text((await run('report 12', room)).lines)).toContain('music/12 is hidden now, until someone looks at it')
  })

  it('when this person had already reported it', async () => {
    const { run } = harness({ ok: true, outcome: 'already' })
    expect(text((await run('report 12', room)).lines)).toContain('you have already reported music/12')
  })

  it('the database’s refusal, word for word', async () => {
    const { run } = harness({ ok: false, reason: 'that one is yours.' })
    const out = (await run('report 12', room)).lines
    expect(out[0]).toMatchObject({ text: 'that one is yours.', tone: 'error' })
  })
})

describe('what report refuses before asking anything', () => {
  it('bare, it explains itself and reports nothing', async () => {
    const { run, calls } = harness()
    const out = text((await run('report', room)).lines)
    expect(out).toContain('report <what> <why>')
    expect(calls).toHaveLength(0)
  })

  it('needs a name', async () => {
    const { run, calls } = harness(undefined, null)
    expect(text((await run('report 12', room)).lines)).toContain('you need a name first')
    expect(calls).toHaveLength(0)
  })

  it('a bare number in the lobby, which has no posts', async () => {
    const { run, calls } = harness()
    expect(text((await run('report 12', {} as Location)).lines)).toContain('try: report music/12')
    expect(calls).toHaveLength(0)
  })

  it('post, when no post is open', async () => {
    const { run, calls } = harness()
    expect(text((await run('report post', room)).lines)).toContain('open the post first')
    expect(calls).toHaveLength(0)
  })

  it('something that is not an aim', async () => {
    const { run, calls } = harness()
    expect(text((await run('report everything', room)).lines)).toContain('report what?')
    expect(calls).toHaveLength(0)
  })
})

describe('report in help', () => {
  it('is listed with the things you can do anywhere', async () => {
    const { run } = harness()
    expect(text((await run('help', room)).lines)).toContain('report — flag something that should not be here')
  })

  it('and flag means the same thing', () => {
    expect(findCommand('flag')?.verb).toBe('report')
  })
})

describe('in the demo', () => {
  it('says plainly that nothing was sent', async () => {
    const run = createRunner(
      fixtureEnv(ROOMS.map((r) => ({ ...r }))),
      ['commons'],
      new Session({} as SignupApi, {} as Writer, 'ryan'),
    )
    expect(text((await run('report 12', room)).lines)).toContain('nothing was sent — this is a demo')
  })
})
