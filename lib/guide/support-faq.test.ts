import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FLAG_NAMES, findCommand } from '@/lib/commands/registry'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv } from '@/lib/shell/env'
import { ROOMS } from '@/lib/shell/fixtures'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Location } from '@/lib/shell/types'

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
  .filter((span) => !/^[\w.-]+\/[\w.-]+\.\w+$/.test(span) && !/\.(ts|md)$/.test(span))

describe('the support bot’s FAQ', () => {
  it('has at least a dozen questions', () => {
    expect(faq.match(/^## \d+\. /gm)!.length).toBeGreaterThanOrEqual(12)
  })

  it('names commands, so the check below means something', () => {
    expect(commands.length).toBeGreaterThan(15)
  })

  /*
   * Two kinds of real word that are not commands. `cancel` is answered by the
   * session itself, while you are writing or being asked something. And `find`'s
   * options, which are checked against its own list rather than waved through
   * for starting with two dashes.
   */
  const SESSION_WORDS = new Set(['cancel'])

  for (const span of new Set(commands)) {
    it(`\`${span}\` starts with something that exists`, async () => {
      const word = span.split(/\s+/)[0]
      if (SESSION_WORDS.has(word)) return
      // An address, like `music/12`: real if going there opens a post.
      if (/^[~\w-]+\/\d+$/.test(span)) {
        const session = new Session({} as SignupApi, {} as Writer, 'ryan')
        const run = createRunner(fixtureEnv(ROOMS.map((r) => ({ ...r }))), ['commons'], session)
        const result = await run(`go ${span}`, {})
        expect(result.location, `${span} is not an address that opens anything`).toMatchObject({ postId: expect.any(Number) })
        return
      }
      if (word.startsWith('--')) {
        expect(FLAG_NAMES, `${word} is not one of find's options`).toContain(word.slice(2).split('=')[0])
        return
      }
      expect(findCommand(word), `${word} is not a command — the bot would be teaching something that does not work`).toBeDefined()
    })
  }

  it('says 100 characters, which is what a description may be', async () => {
    const { GLOSS_MAX } = await import('@/lib/commands/registry')
    expect(faq).toContain(`up to ${GLOSS_MAX}`)
  })

  /*
   * Run, not just looked up. The first draft said `reply music/12` "works from
   * anywhere" — and on its own it is refused, because a reply's words go on the
   * same line. Somebody copying the bot's answer letter for letter would have
   * hit that. So every complete example (more than one word) is typed into the
   * demo world, from the lobby, a room and a post, and has to work from at least
   * one of them.
   *
   * Except the ones that talk to the real account system, which the demo's
   * stand-in cannot: signing in, renaming, signing out, resending a key.
   */
  const needsRealAccounts = new Set(['login', 'rename', 'logout', 'resend'])
  const examples = [...new Set(commands)].filter(
    (span) => span.includes(' ') && !needsRealAccounts.has(span.split(/\s+/)[0]),
  )

  it('gives complete examples, so the check below means something', () => {
    expect(examples.length).toBeGreaterThan(10)
  })

  for (const example of examples) {
    it(`\`${example}\` works when typed exactly as written`, async () => {
      const places: Location[] = [{}, { room: 'music' }, { room: 'music', postId: 12 }]
      const refusals: string[] = []
      for (const place of places) {
        const writer: Writer = { post: async () => 99, reply: async () => 9 } as unknown as Writer
        const session = new Session({} as SignupApi, writer, 'ryan')
        const run = createRunner(fixtureEnv(ROOMS.map((r) => ({ ...r }))), ['commons'], session)
        const result = await run(example, place)
        const refused = result.lines.find((line) => line.tone === 'error')
        // An example about a room the reader has in mind (`go cycling`) is
        // refused here only because the demo has no such room — which is the
        // command working. Anything else is a real refusal.
        // Likewise `report room`, which the FAQ tells you to type in a room
        // somebody made: the demo's rooms all came with the building, and being
        // told so is the command working.
        if (!refused || /^there’s no room called |came with the building/.test(refused.text)) return
        refusals.push(`${JSON.stringify(place)}: ${refused.text}`)
      }
      expect.fail(`refused everywhere it was tried:\n${refusals.join('\n')}`)
    })
  }
})
