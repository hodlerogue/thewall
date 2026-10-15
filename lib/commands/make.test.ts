import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GLOSS_MAX, GLOSS_MIN } from '@/lib/commands/registry'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'

/**
 * Making a room whose description is too long.
 *
 * Reported with a screenshot, from the lobby:
 *
 *     ryan:lobby$ make pulsechain
 *     what is pulsechain for?
 *     ryan:lobby$ a gathering place for the most decentralized blockchain in crypto
 *     say what it is for, in a few words — that is the line under the name in the lobby.
 *     ryan:lobby$ say a gathering place for the most decentralized blockchain in crypto
 *     you have to be in a room first. try: go music
 *
 * Sixty-five characters against a limit of sixty. Two things went wrong. The
 * refusal named neither the problem nor the number, and was advice that had
 * already been followed. And the question was spent once answered, so the next
 * attempt ran as a command — which is why `say` turned up in the lobby, about a
 * room that did not exist yet.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')

const LONG = 'a gathering place for the most decentralized blockchain in crypto'
const lobby = {} as Location

function harness() {
  // Its own empty world. `fixtureEnv()` with no argument is the demo's shared
  // room list, and `make` pushes into it — so a room made in one test was
  // still there in the next, and every "nothing was made" assertion failed.
  const env = fixtureEnv([])
  const session = new Session({} as SignupApi, {} as Writer, 'ryan')
  return { env, run: createRunner(env, ['commons'], session) }
}

describe('a description that is too long', () => {
  it('is the length in the report, so these tests are about the real case', () => {
    expect(LONG.length).toBe(65)
    expect(LONG.length).toBeGreaterThan(GLOSS_MAX)
  })

  it('says how long it is, and how long it may be', async () => {
    const { run } = harness()
    await run('make pulsechain', lobby)
    const out = text((await run(LONG, lobby)).lines)

    expect(out).toContain('65 characters')
    expect(out).toContain(`fit in ${GLOSS_MAX}`)
    expect(out).toContain('cut 5')
  })

  it('asks again, so the next try is an answer and not a command', async () => {
    // The loop in the screenshot: refused, back at the prompt, and the next
    // attempt run as `say` in a lobby with no room to say it in.
    const { env, run } = harness()
    await run('make pulsechain', lobby)
    const refused = await run(LONG, lobby)
    expect(text(refused.lines)).toContain('what is pulsechain for?')

    const made = await run('a gathering place for decentralized blockchains', lobby)
    expect(text(made.lines)).toContain('pulsechain is open')
    expect((await env.getRoom('pulsechain'))?.gloss).toBe('a gathering place for decentralized blockchains')
  })

  it('keeps asking for as long as it takes', async () => {
    const { env, run } = harness()
    await run('make pulsechain', lobby)
    await run(LONG, lobby)
    const again = await run(`${LONG} and then some`, lobby)

    expect(text(again.lines)).toContain('characters')
    expect(text(again.lines)).toContain('what is pulsechain for?')
    expect(await env.getRoom('pulsechain')).toBeUndefined()
  })

  it('makes nothing while it is refusing', async () => {
    const { env, run } = harness()
    await run('make pulsechain', lobby)
    await run(LONG, lobby)
    expect(await env.getRoom('pulsechain')).toBeUndefined()
  })

  it('says the limit up front, before anybody has written too much', async () => {
    const { run } = harness()
    const asked = text((await run('make pulsechain', lobby)).lines)
    expect(asked).toContain(`${GLOSS_MAX} characters at most`)
  })

  it('does the same on one line, and asks only for the description', async () => {
    // `make pulsechain <65 characters>` — refused, then asked for the part that
    // was wrong. The name was fine and is not asked for again.
    const { env, run } = harness()
    const first = text((await run(`make pulsechain ${LONG}`, lobby)).lines)
    expect(first).toContain('65 characters')
    expect(first).toContain('what is pulsechain for?')

    await run('decentralized blockchain talk', lobby)
    expect((await env.getRoom('pulsechain'))?.gloss).toBe('decentralized blockchain talk')
  })

  it('takes exactly the limit', async () => {
    const { env, run } = harness()
    const sixty = 'x'.repeat(GLOSS_MAX)
    await run('make pulsechain', lobby)
    await run(sixty, lobby)
    expect((await env.getRoom('pulsechain'))?.gloss).toBe(sixty)
  })
})

describe('a description that is too short', () => {
  it('says so and asks again', async () => {
    const { env, run } = harness()
    await run('make pulsechain', lobby)
    const out = text((await run('pc', lobby)).lines)

    expect(out).toContain('too short')
    expect(out).toContain(`${GLOSS_MIN} characters at least`)
    expect(out).toContain('what is pulsechain for?')
    expect(await env.getRoom('pulsechain')).toBeUndefined()
  })
})

describe('the limits are the database’s', () => {
  /*
   * The same arrangement as the post body limit in `write.test.ts`: the
   * migrations are read and the last definition wins, exactly as applying them
   * in order does. A client that allowed 70 would let somebody past this
   * question only for the server to refuse them with the old sentence.
   */
  const dir = join(__dirname, '..', '..', 'supabase', 'migrations')
  const schema = readdirSync(dir)
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
  const declared = [...schema.matchAll(/char_length\(v_gloss\) < (\d+) or char_length\(v_gloss\) > (\d+)/g)]
  const [, min, max] = declared[declared.length - 1]

  it('found the check, so a passing suite means something', () => {
    expect(declared.length).toBeGreaterThan(0)
  })

  it('agree at the top', () => {
    expect(GLOSS_MAX).toBe(Number(max))
  })

  it('agree at the bottom', () => {
    expect(GLOSS_MIN).toBe(Number(min))
  })
})
