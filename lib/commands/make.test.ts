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

/** The description from the report — 65 characters, refused at the old limit of 60. */
const REPORTED = 'a gathering place for the most decentralized blockchain in crypto'

/** Over the current limit by five, the way the reported one was over the old. */
const LONG = 'a gathering place for the most decentralized blockchain in crypto, and for everyone who is building on it'
const lobby = {} as Location

function harness() {
  // Its own empty world. `fixtureEnv()` with no argument is the demo's shared
  // room list, and `make` pushes into it — so a room made in one test was
  // still there in the next, and every "nothing was made" assertion failed.
  const env = fixtureEnv([])
  const session = new Session({} as SignupApi, {} as Writer, 'ryan')
  return { env, run: createRunner(env, ['commons'], session) }
}

describe('the description from the report', () => {
  it('is accepted now that the limit is 100', async () => {
    // Asked for in so many words: "i'd like the description to be able to be
    // longer, so like 100 characters". The line that started all this fits.
    const { env, run } = harness()
    expect(REPORTED.length).toBe(65)
    await run('make pulsechain', lobby)
    await run(REPORTED, lobby)
    expect((await env.getRoom('pulsechain'))?.gloss).toBe(REPORTED)
  })
})

describe('a description that is too long', () => {
  it('is over the limit by five, so these tests are about a real case', () => {
    expect(LONG.length).toBe(GLOSS_MAX + 5)
  })

  it('says how long it is, and how long it may be', async () => {
    const { run } = harness()
    await run('make pulsechain', lobby)
    const out = text((await run(LONG, lobby)).lines)

    expect(out).toContain(`${GLOSS_MAX + 5} characters`)
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
    expect(first).toContain(`${GLOSS_MAX + 5} characters`)
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

/**
 * Answering the question with a command.
 *
 * Reported: "im in the prompt to write the description and i will do something
 * like leave, or go omaha, or some other room, and then i set the description
 * of the room as that. at minimum there should be a confirmation."
 */
describe('an answer that is also a command', () => {
  for (const habit of ['leave', 'go omaha', 'look', 'help']) {
    it(`asks before "${habit}" becomes the description`, async () => {
      const { env, run } = harness()
      await run('make pulsechain', lobby)
      const out = text((await run(habit, lobby)).lines)

      expect(out).toContain(`“${habit}” is something you can type, too`)
      expect(out).toContain('is that what pulsechain is for?')
      expect(await env.getRoom('pulsechain')).toBeUndefined()
    })
  }

  it('uses it on y, for the description that really does start with a verb', async () => {
    const { env, run } = harness()
    await run('make bookclub', lobby)
    await run('read along with us, a chapter a week', lobby)
    await run('y', lobby)
    expect((await env.getRoom('bookclub'))?.gloss).toBe('read along with us, a chapter a week')
  })

  it('asks for the description again on n', async () => {
    const { env, run } = harness()
    await run('make pulsechain', lobby)
    await run('leave', lobby)
    const again = text((await run('n', lobby)).lines)

    expect(again).toContain('what is pulsechain for?')
    await run('decentralized blockchain talk', lobby)
    expect((await env.getRoom('pulsechain'))?.gloss).toBe('decentralized blockchain talk')
  })

  it('stops making the room on cancel, for somebody who did mean leave', async () => {
    const { env, run } = harness()
    await run('make pulsechain', lobby)
    await run('leave', lobby)
    await run('cancel', lobby)
    expect(await env.getRoom('pulsechain')).toBeUndefined()
    // And the prompt is a prompt again: this runs, rather than answering.
    expect(text((await run('look', lobby)).lines)).not.toContain('is that what pulsechain is for?')
  })

  it('asks again on anything that is not yes or no, rather than guessing', async () => {
    const { env, run } = harness()
    await run('make pulsechain', lobby)
    await run('go omaha', lobby)
    const out = text((await run('go omaha', lobby)).lines)
    expect(out).toContain('y or n.')
    expect(await env.getRoom('pulsechain')).toBeUndefined()
  })

  it('does not ask about an ordinary description', async () => {
    const { env, run } = harness()
    await run('make pulsechain', lobby)
    const out = text((await run('decentralized blockchain talk', lobby)).lines)
    expect(out).not.toContain('something you can type')
    expect(await env.getRoom('pulsechain')).toBeDefined()
  })

  it('does not ask on one line, where the words were meant', async () => {
    const { env, run } = harness()
    await run('make pulsechain go long or go home', lobby)
    expect((await env.getRoom('pulsechain'))?.gloss).toBe('go long or go home')
  })
})

/**
 * describe — the maker changing what their room says it is for.
 *
 * Asked for as the repair for the above: "maybe creator should be able to
 * change it (unless that's too much work and risky)".
 */
describe('describe', () => {
  const room = (slug: string, madeBy?: string) => ({
    slug,
    gloss: 'what it was for before',
    ephemeral: false,
    posts: [],
    ...(madeBy ? { madeBy } : {}),
  })
  const at = (slug: string) => ({ room: slug }) as Location

  function world(rooms: ReturnType<typeof room>[], name: string | null = 'ryan') {
    const env = fixtureEnv(rooms)
    const session = new Session({} as SignupApi, {} as Writer, name)
    return { env, run: createRunner(env, ['commons'], session) }
  }

  it('changes a room you made, and prints it the way a room is listed', async () => {
    const { env, run } = world([room('pulsechain', 'you')])
    const out = await run('describe a gathering place for decentralized blockchains', at('pulsechain'))

    expect((await env.getRoom('pulsechain'))?.gloss).toBe('a gathering place for decentralized blockchains')
    expect(out.lines[0]).toMatchObject({ text: 'pulsechain', tone: 'accent' })
    expect(out.lines[1].text).toBe('a gathering place for decentralized blockchains')
  })

  it('fixes the exact mistake it exists for', async () => {
    const { env, run } = world([])
    await run('make pulsechain', {} as Location)
    await run('leave', {} as Location)
    await run('y', {} as Location)
    expect((await env.getRoom('pulsechain'))?.gloss).toBe('leave')

    await run('describe a gathering place for decentralized blockchains', at('pulsechain'))
    expect((await env.getRoom('pulsechain'))?.gloss).toBe('a gathering place for decentralized blockchains')
  })

  it('refuses a room somebody else made, without saying who', async () => {
    const { env, run } = world([room('jazz', 'marisol')])
    const out = text((await run('describe mine now', at('jazz'))).lines)
    expect(out).toContain('only whoever made jazz')
    expect(out).not.toContain('marisol')
    expect((await env.getRoom('jazz'))?.gloss).toBe('what it was for before')
  })

  it('refuses the rooms that came with the building', async () => {
    const { env, run } = world([room('music')])
    expect(text((await run('describe all music all the time', at('music'))).lines)).toContain(
      'came with the building',
    )
    expect((await env.getRoom('music'))?.gloss).toBe('what it was for before')
  })

  it('says the numbers when it is too long, and changes nothing', async () => {
    const { env, run } = world([room('pulsechain', 'you')])
    const out = text((await run(`describe ${LONG}`, at('pulsechain'))).lines)
    expect(out).toContain(`${GLOSS_MAX + 5} characters`)
    expect((await env.getRoom('pulsechain'))?.gloss).toBe('what it was for before')
  })

  it('shows what it says now when typed bare, and asks nothing', async () => {
    // Never a question: a question is what let `leave` become a description.
    const { run } = world([room('pulsechain', 'you')])
    const out = text((await run('describe', at('pulsechain'))).lines)
    expect(out).toContain('pulsechain says: what it was for before')
    expect(out).toContain('describe <a few words>')
    expect(text((await run('look', at('pulsechain'))).lines)).not.toContain('pulsechain says')
  })

  it('needs a name', async () => {
    const { run } = world([room('pulsechain', 'you')], null)
    expect(text((await run('describe anything at all', at('pulsechain'))).lines)).toContain(
      'you need a name first',
    )
  })

  it('works from inside a post in the room', async () => {
    const { env, run } = world([room('pulsechain', 'you')])
    await run('describe decentralized blockchain talk', { room: 'pulsechain', postId: 1 } as Location)
    expect((await env.getRoom('pulsechain'))?.gloss).toBe('decentralized blockchain talk')
  })

  it('is mentioned when a room is made, which is when its maker needs it', async () => {
    const { run } = world([])
    const out = text((await run('make pulsechain decentralized blockchain talk', {} as Location)).lines)
    expect(out).toContain('describe <a few words> changes what it says it is for')
  })
})
