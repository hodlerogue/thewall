import { describe, expect, it } from 'vitest'
import { USAGE } from '@/lib/commands/manual'
import { COMMANDS } from '@/lib/commands/registry'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'

/*
 * The manual, and help being one thing whichever way it is asked for.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')
const MUSIC: Location = { room: 'music' }

function run(input: string, at: Location = MUSIC) {
  const session = new Session({} as SignupApi, {} as Writer, 'tester')
  return Promise.resolve(createRunner(fixtureEnv(), ['commons'], session)(input, at)).then((r) => text(r.lines))
}

describe('every command is in the manual', () => {
  it('each has at least one form, and each form starts with its own verb or a line it reads', () => {
    for (const command of COMMANDS) {
      const forms = USAGE[command.verb]
      expect(forms, `${command.verb} has no entry in lib/commands/manual.ts`).toBeDefined()
      expect(forms!.length).toBeGreaterThan(0)
      for (const form of forms!) expect(form, command.verb).toMatch(/ — /)
    }
  })

  it('and nothing in it names a command that is gone', () => {
    const verbs = new Set(COMMANDS.map((c) => c.verb))
    for (const verb of Object.keys(USAGE)) expect(verbs.has(verb), `${verb} is not a command`).toBe(true)
  })

  it('help all prints every one, folded and rarely-needed ones too', async () => {
    const out = await run('help all')
    for (const command of COMMANDS) expect(out).toContain(`\n${command.verb}\n`)
    expect(out).toContain('find --rooms <words>')
  })
})

describe('help <command> is what <command>', () => {
  it('rather than the whole list again', async () => {
    const help = await run('help find')
    expect(help).toBe(await run('what find'))
    expect(help).not.toMatch(/from here you can type/)
  })

  it('with the forms to copy, --rooms included', async () => {
    const out = await run('what find')
    expect(out).toMatch(/find --rooms <words> — rooms/)
    expect(out).toMatch(/find <words> \| count/)
  })

  it('and an unknown one is answered the same way from both', async () => {
    expect(await run('help frobnicate')).toBe(await run('what frobnicate'))
  })

  it('and help itself points at both', async () => {
    expect(await run('help')).toMatch(/help <command> explains one\. help all lists every command/)
  })
})

describe('glosses say what a command does, not what I want', () => {
  it('none in the first person', () => {
    for (const command of COMMANDS) {
      for (const context of command.contexts) {
        expect(command.gloss(context), command.verb).not.toMatch(/\b(my|me|i)\b/)
      }
    }
  })
})
