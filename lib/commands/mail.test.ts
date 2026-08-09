import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv, type Env, type MailItem } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'

/**
 * §4.1 — what you see when a pile of replies is waiting.
 *
 * The doc calls notifications its highest-priority unsolved item, on the
 * grounds that "no notification means no reason to return". That makes this the
 * one screen somebody arrives at *because* they were told to, so it has to
 * answer the question it was summoned by: how many, from whom, and how do I get
 * to them.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')

function harness(items: MailItem[]) {
  const base = fixtureEnv()
  const env: Env = { ...base, async readMail() { return items } }

  const api: SignupApi = {
    async checkName() {
      return { available: true, alternates: [] }
    },
    async create(name) {
      return { ok: true as const, name }
    },
    async logout() {
      return { ok: true as const }
    },
    async login(name: string) {
      return { ok: true as const, name, note: 'sent' }
    },
    async loginCode(name: string) {
      return { ok: true as const, name }
    },
    async resend() {
      return { note: '' }
    },
  }
  const writer: Writer = {
    async post() {
      return 1
    },
    async reply() {
      return 1
    },
    async rename(name: string) {
      return { ok: true as const, name }
    },
  }

  return { run: createRunner(env, ['commons'], new Session(api, writer, 'jameson')) }
}

const reply = (room: string, postId: number, author: string, body: string): MailItem => ({
  room,
  postId,
  author,
  body,
  createdAt: new Date(Date.now() - 60_000),
})

const ANYWHERE: Location = {}

describe('a pile of replies', () => {
  it('says how many, before the list of them', async () => {
    /*
     * The composer badge says "you have 12 replies waiting" and `mail` clears
     * it. Without a count here, the number somebody was just told vanishes at
     * the exact moment they act on it, and a long list arrives with nothing to
     * measure it against.
     */
    const { run } = harness([
      reply('music', 12, 'marisol', 'warped ones still play'),
      reply('kitchen', 8, 'ren', 'freeze it flat in bags'),
      reply('music', 12, 'tuck', 'what was in there'),
    ])

    const out = text((await run('mail', ANYWHERE)).lines)
    expect(out).toContain('3 replies, oldest first.')
  })

  it('does not count out loud when there is one', async () => {
    const { run } = harness([reply('music', 12, 'marisol', 'warped ones still play')])
    expect(text((await run('mail', ANYWHERE)).lines)).not.toContain('1 replies')
  })

  it('gives every one an address you can walk to', async () => {
    const { run } = harness([
      reply('music', 12, 'marisol', 'warped ones still play'),
      reply('kitchen', 8, 'ren', 'freeze it flat in bags'),
    ])
    const out = text((await run('mail', ANYWHERE)).lines)

    expect(out).toContain('music/12')
    expect(out).toContain('kitchen/8')
    expect(out).toContain('warped ones still play')
  })

  it('offers one step to the newest, not two', async () => {
    // This said "go music then go 12", with a comment claiming `go music/12`
    // was not a thing — true when written, and not since `go` learned to take a
    // whole address. Two steps where one works, in the listing whose whole
    // purpose is getting you there.
    const { run } = harness([reply('music', 12, 'marisol', 'warped ones still play')])
    const out = text((await run('mail', ANYWHERE)).lines)

    expect(out).toContain('go music/12 to answer the newest.')
    expect(out).not.toContain('then go')
  })

  it('walks to it, so the instruction is not a guess', async () => {
    const { run } = harness([reply('music', 12, 'marisol', 'warped ones still play')])
    const result = await run('go music/12', ANYWHERE)
    expect(result.location).toEqual({ room: 'music', postId: 12 })
  })

  it('says when it has shown all it will, rather than truncating quietly', async () => {
    /*
     * Reading is what marks mail read — §4.1 is pull-only, so looking is the
     * only signal there is. The query asks for the newest 100, so anything past
     * the cap is older than everything shown, and hitting it clears replies
     * that were never displayed. That cannot be avoided without a per-reply
     * read model, so it is said out loud instead of being found out by noticing
     * a gap.
     */
    const many = Array.from({ length: 100 }, (_, i) =>
      reply('music', 12, 'marisol', `reply number ${i}`),
    )
    const lines = (await harness(many).run('mail', ANYWHERE)).lines
    const out = text(lines)

    expect(out).toContain('these are the newest 100')
    expect(out).toContain('cleared too')
  })

  it('puts the cap notice above the list, where the boundary actually is', async () => {
    /*
     * It used to print last, which was right when the list ran newest-first:
     * the cut was at the bottom. Now the list runs oldest-first, so the cut is
     * at the top, and a notice underneath would be pointing at the newest
     * replies and calling them the ones that got dropped.
     */
    const many = Array.from({ length: 100 }, (_, i) =>
      reply('music', 12, 'marisol', `reply number ${i}`),
    )
    const lines = (await harness(many).run('mail', ANYWHERE)).lines
    const notice = lines.findIndex((line) => line.text.includes('newest 100'))
    const firstReply = lines.findIndex((line) => line.text.includes('reply number'))

    expect(notice).toBeGreaterThanOrEqual(0)
    expect(notice).toBeLessThan(firstReply)
  })

  it('stays quiet about the cap when it was not reached', async () => {
    const some = Array.from({ length: 12 }, (_, i) => reply('music', 12, 'marisol', `r${i}`))
    expect(text((await harness(some).run('mail', ANYWHERE)).lines)).not.toContain('newest 100')
  })

  it('clears the badge, because looking is the only read signal there is', async () => {
    const { run } = harness([reply('music', 12, 'marisol', 'x')])
    expect((await run('mail', ANYWHERE)).mail).toBe(0)
  })

  it('says nothing waiting rather than showing an empty list', async () => {
    const { run } = harness([])
    expect(text((await run('mail', ANYWHERE)).lines)).toBe('nothing waiting.')
  })
})
