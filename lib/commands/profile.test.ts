import { describe, expect, it } from 'vitest'
import { CHIP_SETS, COMMANDS, findCommand, OWN_WALL_CHIPS } from '@/lib/commands/registry'
import { chipsForContext, createChipsFor, createRunner } from '@/lib/commands/run'
import { fixtureEnv } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Context, Line, Location } from '@/lib/shell/types'

/**
 * A profile, and the wall behind it.
 *
 * This started as a view with nothing postable on it, on §3.10's warning that a
 * space which absorbs activity "deletes the geography that makes this feel like
 * a place". Walls exist now, so the property under test moved rather than
 * disappeared: a wall is a *room with an owner*, only its owner may start
 * things on it, anyone may answer them, and no wall ever appears in the lobby —
 * which is where §3.10's warning actually bites.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')

function harness(me: string | null = 'jameson') {
  const posted: { room: string; body: string }[] = []
  const replied: { room: string; postId: number; body: string }[] = []

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
    async reply(room, postId, body) {
      replied.push({ room, postId, body })
    },
    async rename(name: string) {
      return { ok: true as const, name }
    },
  }

  // Named by default, so a refusal to post cannot be mistaken for the signup
  // ask; `null` is how the nameless-visitor path gets exercised.
  const session = new Session(api, writer, me)
  return { run: createRunner(fixtureEnv(), ['commons'], session), posted, replied }
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

describe('a wall belongs to one person', () => {
  it('refuses somebody else’s wall by naming what you can do instead (§3.7)', async () => {
    const { run, posted } = harness()
    const out = text((await run('say hello there', AT.person)).lines)

    expect(out).toContain('marisol')
    // Not "you can't" — the fix, which is that answering is open to everyone,
    // named against a post that is really on the wall.
    expect(out).toContain('you can answer what’s here: go 2'.replace('’', "'"))
    expect(posted).toHaveLength(0)
  })

  it('puts your own words on your own wall', async () => {
    const { run, posted } = harness('marisol')
    const result = await run('say tomatoes again', { person: 'marisol' })

    expect(posted).toEqual([{ room: '~marisol', body: 'tomatoes again' }])
    expect(result.retry).toBeUndefined()
  })

  it('does not ask a nameless visitor for a name it cannot use', async () => {
    /*
     * §3.9 asks for an account at the moment of contribution, and that is
     * exactly why it must not fire here: a page only exists for somebody who
     * exists, so a visitor with no name is never on their own wall. Asking
     * would take a name in exchange for a sentence the wall then refuses.
     */
    const { run, posted } = harness(null)
    const out = text((await run('say my first thing', { person: 'ren' })).lines)

    expect(out).not.toMatch(/what should i call you/i)
    expect(out).toContain("only they can put things on it")
    expect(posted).toHaveLength(0)
  })

  it('offers say on your own page and nowhere else', () => {
    // The set for somebody else's page has no `say`: a palette that names a
    // verb which always fails teaches the wrong thing.
    expect(CHIP_SETS.person).not.toContain('say')
    expect(chipsForContext('person').map((chip) => chip.verb)).not.toContain('say')

    const mine = createChipsFor(['commons'])({ person: 'marisol' }, 'marisol')
    expect(mine.map((chip) => chip.verb)).toContain('say')
    expect(mine[0].verb).toBe('say')

    const theirs = createChipsFor(['commons'])({ person: 'marisol' }, 'jameson')
    expect(theirs.map((chip) => chip.verb)).not.toContain('say')

    // And a guest sees somebody else's page, not an invitation to post on it.
    expect(
      createChipsFor(['commons'])({ person: 'marisol' }, null).map((chip) => chip.verb),
    ).not.toContain('say')
  })

  it('opens a wall post by its number, from the page it is on', async () => {
    const { run } = harness()
    const result = await run('go 2', AT.person)

    expect(result.location).toEqual({ room: '~marisol', postId: 2 })
    expect(text(result.lines)).toContain('neighbours')
  })

  it('says so when the number is not on their wall', async () => {
    const { run } = harness()
    const out = text((await run('go 12', AT.person)).lines)
    expect(out).toContain('marisol')
    expect(out).toContain('try: look')
  })

  it('lets anybody answer what is on it', async () => {
    const { run, replied } = harness()
    // Inside a wall post you are inside a post, exactly as in any other room —
    // which is the whole reason a wall was built as a room and not a new thing.
    await run('reply the fan people are correct', { room: '~marisol', postId: 2 })
    expect(replied).toEqual([
      { room: '~marisol', postId: 2, body: 'the fan people are correct' },
    ])
  })

  it('backs out of a wall post to the person, not to a room of the same name', async () => {
    // `{room:'~marisol'}` and `{person:'marisol'}` would print the same prompt
    // and the same URL, and a reload resolves that path to the person — so
    // leaving must not invent the other one.
    const { run } = harness()
    const result = await run('leave', { room: '~marisol', postId: 2 })

    expect(result.location).toEqual({ person: 'marisol' })
    expect(text(result.lines)).toContain('arrived')
  })

  it('goes to a whole address, which is what every listing prints', async () => {
    const { run } = harness()

    // The shape `find`, `mail` and a profile all print, typed straight back.
    const wall = await run('go ~marisol/2', AT.lobby)
    expect(wall.location).toEqual({ room: '~marisol', postId: 2 })

    const room = await run('go music/12', AT.lobby)
    expect(room.location).toEqual({ room: 'music', postId: 12 })

    // And a miss names the room rather than reporting the wrong thing — the
    // tilde branch used to answer "there's no one called marisol/9".
    const gone = text((await run('go ~marisol/9', AT.lobby)).lines)
    expect(gone).toContain('nothing at ~marisol/9')
    expect(gone).not.toContain('no one called')
  })

  it('never puts a wall in the lobby (§4.2)', async () => {
    const { run } = harness()
    const lobby = text((await run('look', AT.lobby)).lines)
    expect(lobby).not.toContain('~')
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
      for (const verb of [...CHIP_SETS[context], ...(context === 'person' ? OWN_WALL_CHIPS : [])]) {
        const command = findCommand(verb)
        expect(command, `${context}/${verb}`).toBeDefined()
        expect(command!.contexts, `${context}/${verb}`).toContain(context)
        expect(command!.hidden, `${context}/${verb}`).toBeFalsy()
      }
    }
  })

  it('leaves say valid exactly where contributing is (§3.3)', () => {
    const say = COMMANDS.find((c) => c.verb === 'say')!
    // `person` is in here because a wall is somewhere you contribute. Whether
    // *this* person may is the handler's business, not the context's — the
    // same distinction that lets `say` be valid in a room you have no name in.
    expect([...say.contexts].sort()).toEqual(['commons', 'person', 'post', 'room'])
  })
})

describe('§7 — doctor, for when the message could mean three things', () => {
  it('is hidden, like the other things nobody arriving needs', () => {
    const doctor = COMMANDS.find((c) => c.verb === 'doctor')!
    expect(doctor.hidden).toBe(true)
    // And therefore never proposed by a "did you mean".
    expect(CHIP_SETS.lobby).not.toContain('doctor')
  })

  it('works from anywhere, because trouble is not context-sensitive', () => {
    const doctor = COMMANDS.find((c) => c.verb === 'doctor')!
    for (const context of Object.keys(CHIP_SETS) as Context[]) {
      expect(doctor.contexts, context).toContain(context)
    }
  })

  it('reports the build, which is the line that ends the guessing', async () => {
    const { run } = harness()
    const out = text((await run('doctor', AT.room)).lines)
    expect(out).toContain('build')
  })

  it('says what the data actually is, rather than implying it is real', async () => {
    // Against fixtures it has to admit as much. A diagnostic that reports
    // health while serving invented content is worse than none.
    const { run } = harness()
    const out = text((await run('doctor', AT.room)).lines)
    expect(out).toContain('fixtures')
  })

  it('answers to the words somebody actually types when stuck', async () => {
    for (const word of ['doctor', 'diagnose', 'debug']) {
      const { run } = harness()
      const out = text((await run(word, AT.room)).lines)
      expect(out, word).toContain('what is actually running')
    }
  })
})


describe('a profile lists replies as replies', () => {
  it('marks them, so an address is not read as somebody else’s post', async () => {
    /*
     * A regression that arrived with the search fix. `getProfile` runs the same
     * query `find --by=` does, and once that learned to cover replies, profiles
     * started listing them — rendered exactly like posts.
     *
     * So marisol's page showed `music/12` above her answer to jameson's post,
     * as though the post were hers, and following that address lands on his.
     * `find` grew the marker at the time; this did not.
     */
    const { run } = harness()
    const out = text((await run('go ~marisol', AT.lobby)).lines)

    // Her reply in music, which is jameson's post.
    expect(out).toContain('warped ones still play')
    expect(out).toMatch(/music\/12.*\(reply\)/)

    // And a real post of hers carries no marker.
    expect(out).toMatch(/kitchen\/8(?!.*\(reply\))/)
  })

  it('shows what somebody said, which is posts and replies both', async () => {
    // The question a profile answers is "what has this person said", and the
    // answer was quietly only ever half of it.
    const { run } = harness()
    const out = text((await run('go ~marisol', AT.lobby)).lines)

    expect(out).toContain('the trick with the tomatoes')
    expect(out).toContain('the refrigerator and i are also here')
  })
})
