import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findCommand } from '@/lib/commands/registry'

/**
 * The support bot's FAQ teaches real commands.
 *
 * `docs/support-faq.md` is pasted into an AI bot that lives on the feedback
 * room, outside this codebase, where nothing would ever notice it going stale.
 * A bot confidently telling somebody to type a command that was renamed last
 * month is worse than no bot. So every command it names in backticks is looked
 * up in the registry here — the same reason /about's command list is generated
 * rather than written by hand.
 */
const faq = readFileSync(join(__dirname, '..', '..', 'docs', 'support-faq.md'), 'utf8')
const commands = [...faq.matchAll(/`([^`]+)`/g)]
  .map((m) => m[1])
  // The file names itself and its test in backticks; those are paths.
  .filter((span) => !span.includes('/') && !span.includes('.'))

describe('the support bot’s FAQ', () => {
  it('has five questions', () => {
    expect(faq.match(/^## \d\. /gm)).toHaveLength(5)
  })

  it('names commands, so the check below means something', () => {
    expect(commands.length).toBeGreaterThan(15)
  })

  for (const span of new Set(commands)) {
    it(`\`${span}\` starts with a command that exists`, () => {
      const word = span.split(/\s+/)[0]
      expect(findCommand(word), `${word} is not a command — the bot would be teaching something that does not work`).toBeDefined()
    })
  }

  it('says 100 characters, which is what a description may be', async () => {
    const { GLOSS_MAX } = await import('@/lib/commands/registry')
    expect(faq).toContain(`up to ${GLOSS_MAX}`)
  })
})
