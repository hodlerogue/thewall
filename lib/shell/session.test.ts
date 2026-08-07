import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { suggestAlternates, validateName } from '@/lib/auth/names'
import { fixtureEnv } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')

function harness(
  options: { taken?: string[]; failCreate?: string; recycled?: Date; me?: string } = {},
) {
  const taken = new Set(options.taken ?? ['jameson'])
  const posted: { room: string; body: string }[] = []
  const renamed: string[] = []
  let resends = 0
  const replied: { room: string; postNo: number; body: string }[] = []

  const api: SignupApi = {
    async checkName(name) {
      const available = !taken.has(name)
      return { available, alternates: available ? [] : suggestAlternates(name, taken) }
    },
    async create(name) {
      if (options.failCreate) return { ok: false as const, reason: options.failCreate }
      return { ok: true as const, name }
    },
    async logout() {
      return { ok: true as const }
    },
    async login(name: string) {
      return { ok: true as const, name, note: 'sent' }
    },
    async resend() {
      resends += 1
      return { note: 'another key is on its way.' }
    },
  }

  const writer: Writer = {
    async post(room, body) {
      posted.push({ room, body })
      return 42
    },
    async reply(room, postNo, body) {
      replied.push({ room, postNo, body })
    },
    async rename(name) {
      if (taken.has(name)) return { ok: false as const, reason: `${name} is taken` }
      renamed.push(name)
      return { ok: true as const, name, recycled: options.recycled }
    },
  }

  // `me` skips the signup ask, for the assertions that are about what a
  // named person sees rather than about §3.9's flow.
  const session = new Session(api, writer, options.me)
  const run = createRunner(fixtureEnv(), ['commons'], session)

  return { session, run, posted, replied, renamed, resendCount: () => resends }
}

describe('§3.9 — signup is deferred to first contribution', () => {
  it('lets you read everything without ever asking who you are', async () => {
    const { run, session } = harness()
    const at: Location = { room: 'music' }

    for (const command of ['look', 'go 12', 'leave', 'who', 'help']) {
      const out = text((await run(command, at)).lines)
      expect(out.toLowerCase(), command).not.toMatch(/what do you want to be called/)
    }
    expect(session.name()).toBeNull()
  })

  it('asks for a name only when you first try to say something', async () => {
    const { run, session } = harness()
    const out = text((await run('say the AC is out again', { room: 'music' })).lines)

    expect(out).toMatch(/what do you want to be called\?/)
    expect(session.isAsking()).toBe(true)
  })

  it('posts the held sentence automatically — you never re-type it', async () => {
    const { run, posted, session } = harness()
    const at: Location = { room: 'music' }
    const sentence = 'found my dad’s records in the garage'

    await run(`say ${sentence}`, at)
    await run('newcomer', at)
    const done = await run('newcomer@example.com', at)

    expect(posted).toEqual([{ room: 'music', body: sentence }])
    expect(text(done.lines)).toMatch(/the thing you were trying to say is up/)
    // The prompt stops saying `guest` in the same breath.
    expect(done.identity).toBe('newcomer')
    expect(session.name()).toBe('newcomer')
    expect(session.isAsking()).toBe(false)
  })

  it('sends the held reply to the post you were standing in', async () => {
    const { run, replied, posted } = harness()
    const at: Location = { room: 'music', postId: 12 }

    await run('say warped ones still play', at)
    await run('newcomer', at)
    await run('newcomer@example.com', at)

    expect(replied).toEqual([{ room: 'music', postNo: 12, body: 'warped ones still play' }])
    expect(posted).toEqual([])
  })

  it('cancel returns to reading with nothing lost and nothing sent', async () => {
    const { run, posted, session } = harness()
    const at: Location = { room: 'music' }

    await run('say something i thought better of', at)
    const out = text((await run('cancel', at)).lines)

    expect(out).toMatch(/nothing sent/)
    expect(posted).toEqual([])
    expect(session.isAsking()).toBe(false)
    expect(session.name()).toBeNull()

    // And the shell is a shell again.
    expect(text((await run('look', at)).lines)).toMatch(/records|bass player/)
  })

  it('cancels from the email question too', async () => {
    const { run, posted } = harness()
    const at: Location = { room: 'music' }
    await run('say hello', at)
    await run('newcomer', at)
    const out = text((await run('cancel', at)).lines)
    expect(out).toMatch(/nothing sent/)
    expect(posted).toEqual([])
  })

  it('treats answers as answers, not commands', async () => {
    const { run, session } = harness()
    const at: Location = { room: 'music' }
    await run('say hello', at)

    // `read` is an alias for `go`. Mid-signup it has to be a name.
    const out = text((await run('read', at)).lines)
    expect(out).not.toMatch(/i don’t know/)
    expect(session.isAsking()).toBe(true)
    // It was accepted as a name and moved on to the second question.
    expect(out).toMatch(/where should i send your key\?/)
  })

  it('never asks for a password — a prompt cannot mask input (§9)', async () => {
    const { run } = harness()
    const at: Location = { room: 'music' }
    const first = text((await run('say hello', at)).lines)
    const second = text((await run('newcomer', at)).lines)
    const all = `${first}\n${second}`.toLowerCase()

    // It may mention passwords, but only to say there aren't any.
    expect(all).not.toMatch(/(choose|enter|pick|type|set) a password|password\?/)
    expect(second).toMatch(/no password/)
  })

  it('suggests alternates when the name is taken, rather than just refusing', async () => {
    const { run } = harness({ taken: ['marisol'] })
    const at: Location = { room: 'music' }
    await run('say hello', at)
    const out = text((await run('marisol', at)).lines)

    expect(out).toMatch(/marisol is taken/)
    expect(out).toMatch(/are free/)
  })

  it('explains a malformed name and offers one that works', async () => {
    const { run } = harness()
    const at: Location = { room: 'music' }
    await run('say hello', at)

    const out = text((await run('Mari Sol!', at)).lines)
    expect(out).toMatch(/letters, numbers and underscores only/)
    expect(out).toMatch(/mari_sol would work/)
  })

  it('does not accept something that is not an email', async () => {
    const { run, posted } = harness()
    const at: Location = { room: 'music' }
    await run('say hello', at)
    await run('newcomer', at)

    const out = text((await run('not-an-email', at)).lines)
    expect(out).toMatch(/doesn’t look like an email/)
    expect(posted).toEqual([])
  })

  it('keeps the held sentence when the account cannot be created', async () => {
    const { run, posted } = harness({ failCreate: 'that email is already here.' })
    const at: Location = { room: 'music' }
    await run('say hello', at)
    await run('newcomer', at)

    const out = text((await run('newcomer@example.com', at)).lines)
    expect(out).toMatch(/already here/)
    expect(posted).toEqual([])
  })

  it('goes straight through once you have a name', async () => {
    const { run, posted, session } = harness()
    const at: Location = { room: 'music' }

    await run('say first', at)
    await run('newcomer', at)
    await run('newcomer@example.com', at)
    posted.length = 0

    const out = text((await run('say second', at)).lines)
    expect(out).toMatch(/music\/42/)
    expect(posted).toEqual([{ room: 'music', body: 'second' }])
    expect(session.isAsking()).toBe(false)
  })

  it('says a guest is not on the list, and why', async () => {
    const { run } = harness()
    const out = text((await run('who', { room: 'music' })).lines)
    expect(out).toMatch(/say something and you’ll be on the list/)
  })
})

describe('§4.7 (revised) — the key has to be gettable', () => {
  it('resend asks for another one', async () => {
    const { run, resendCount } = harness()
    const at: Location = { room: 'music' }

    await run('say hello', at)
    await run('newcomer', at)
    await run('newcomer@example.com', at)

    const out = text((await run('resend', at)).lines)
    expect(out).toMatch(/another key/)
    expect(resendCount()).toBe(1)
  })

  it('does not pretend to resend when there is no account yet', async () => {
    const { run, resendCount } = harness()
    const out = text((await run('resend', { room: 'music' })).lines)
    expect(out).toMatch(/nothing to send yet/)
    expect(resendCount()).toBe(0)
  })

  it('is reachable by the words someone would actually reach for', async () => {
    const { parse } = await import('@/lib/commands/parse')
    for (const word of ['resend', 'verify', 'key']) {
      expect(parse(word)?.command?.verb, word).toBe('resend')
    }
  })

  it('stays out of help, like the pipe — the error that needs it names it', async () => {
    const { run } = harness()
    const out = text((await run('help', { room: 'music' })).lines)
    expect(out).not.toMatch(/resend/)
  })
})

describe('§4.1 — mail is the reason to come back', () => {
  it('tells a guest why they have none, rather than showing an empty box', async () => {
    const { run } = harness()
    const out = text((await run('mail', { room: 'music' })).lines)
    expect(out).toMatch(/reading as a guest/)
    expect(out).toMatch(/say something/)
  })

  it('is reachable by the words someone would reach for', async () => {
    const { parse } = await import('@/lib/commands/parse')
    for (const word of ['mail', 'replies', 'inbox', 'unread']) {
      expect(parse(word)?.command?.verb, word).toBe('mail')
    }
  })

  it('is in help — unlike the pipe, there is no reason to hide it', async () => {
    const { run } = harness()
    const out = text((await run('help', { room: 'music' })).lines)
    expect(out).toMatch(/mail — /)
  })

  it('explains that nothing arrives uninvited (§4.1, as revised)', async () => {
    /*
     * This asserted that `what mail` says nothing is "emailed", which was true
     * until email existed. It is now off-by-default rather than absent, so the
     * claim worth pinning is the one that survived: mail itself still waits to
     * be asked, and the thing that does arrive is named as something you switch
     * on. Leaving the old assertion would have meant the documentation was
     * checked for a sentence that had become false.
     */
    const { run } = harness()
    const out = text((await run('what mail', { room: 'music' })).lines)
    expect(out).toMatch(/nothing is pushed/)
    expect(out).toMatch(/notify on/)
  })
})

describe('name rules match the schema', () => {
  it('accepts what the profiles_name_shape check accepts', () => {
    for (const name of ['ren', 'marisol', 'dev_2', 'a1']) {
      expect(validateName(name), name).toMatchObject({ ok: true })
    }
  })

  it('rejects what the database would reject', () => {
    for (const name of ['a', '', 'x'.repeat(21), 'has space', 'Ünicode', 'dash-name']) {
      expect(validateName(name).ok, name).toBe(false)
    }
  })

  it('lowercases, because names are case-insensitive in the schema', () => {
    expect(validateName('Marisol')).toMatchObject({ ok: true, name: 'marisol' })
  })

  it('keeps reserved names out of reach', () => {
    for (const name of ['guest', 'admin', 'thewall', 'lobby']) {
      expect(validateName(name).ok, name).toBe(false)
    }
  })

  it('only ever suggests names that would themselves be valid', () => {
    const taken = new Set(['ren', 'ren_', 'ren1'])
    for (const suggestion of suggestAlternates('ren', taken)) {
      expect(validateName(suggestion), suggestion).toMatchObject({ ok: true })
      expect(taken.has(suggestion)).toBe(false)
    }
  })

  it('does not suggest anything longer than the column allows', () => {
    const long = 'x'.repeat(20)
    for (const suggestion of suggestAlternates(long, new Set())) {
      expect(suggestion.length).toBeLessThanOrEqual(20)
    }
  })
})

describe('§4.6 revised — rename, as often as you like', () => {
  const at: Location = { room: 'music' }

  async function named(options: Parameters<typeof harness>[0] = {}) {
    const h = harness(options)
    await h.run('say hello', at)
    await h.run('newcomer', at)
    await h.run('newcomer@example.com', at)
    return h
  }

  it('changes what the prompt calls you', async () => {
    const { run, session, renamed } = await named()
    const out = await run('rename betterchoice', at)

    expect(renamed).toEqual(['betterchoice'])
    expect(session.name()).toBe('betterchoice')
    expect(out.identity).toBe('betterchoice')
    expect(text(out.lines)).toMatch(/you’re betterchoice now/)
  })

  it('says out loud what renaming costs', async () => {
    // Both consequences of the two decisions taken here, stated at the moment
    // they become true rather than discovered afterwards: attribution follows
    // the new name, and the old one is immediately anybody's.
    const { run } = await named()
    const out = text((await run('rename betterchoice', at)).lines)
    expect(out).toMatch(/everything you’ve said says betterchoice/)
    expect(out).toMatch(/newcomer is free for anyone to take/)
  })

  it('says when the name has been worn before', async () => {
    const { run } = await named({ recycled: new Date(Date.now() - 3 * 60 * 60_000) })
    const out = text((await run('rename secondhand', at)).lines)
    expect(out).toMatch(/was somebody else’s until 3h ago/)
  })

  it('refuses a taken name without changing anything', async () => {
    const { run, session, renamed } = await named({ taken: ['jameson'] })
    const out = text((await run('rename jameson', at)).lines)

    expect(out).toMatch(/jameson is taken/)
    expect(renamed).toEqual([])
    expect(session.name()).toBe('newcomer')
  })

  it('explains a malformed name the way signup does', async () => {
    const { run, renamed } = await named()
    const out = text((await run('rename Mari Sol!', at)).lines)
    expect(out).toMatch(/letters, numbers and underscores only/)
    expect(renamed).toEqual([])
  })

  it('does not let you take a reserved name by renaming into it', async () => {
    // The signup path checks this; renaming is a second door onto the same
    // room, and `admin` walking in through it would be just as bad.
    const { run, renamed } = await named()
    expect(text((await run('rename admin', at)).lines)).toMatch(/spoken for/)
    expect(renamed).toEqual([])
  })

  it('shrugs at renaming to what you already are', async () => {
    const { run, renamed } = await named()
    expect(text((await run('rename newcomer', at)).lines)).toMatch(/already newcomer/)
    expect(renamed).toEqual([])
  })

  it('tells a guest how to get a name rather than how to change one', async () => {
    const { run, session } = harness()
    const out = text((await run('rename anything', at)).lines)
    expect(out).toMatch(/don’t have a name yet/)
    expect(session.name()).toBeNull()
  })

  it('asks what to rename to, and suggests something, when given nothing', async () => {
    const { run } = await named()
    const out = text((await run('rename', at)).lines)
    expect(out).toMatch(/rename to what/)
    expect(out).toMatch(/newcomer_/)
  })

  it('is a command, not an answer, mid-signup', async () => {
    // Everything typed while a question is open is an answer (§3.9), so this
    // must become a name rather than silently renaming a guest.
    const { run, session } = harness()
    await run('say hello', at)
    await run('rename', at)
    expect(session.isAsking()).toBe(true)
    expect(session.name()).toBeNull()
  })
})

describe('§3.9 — one step back, when the name was wrong', () => {
  const at: Location = { room: 'music' }

  it('says the name back, so a typo is visible before the next question', async () => {
    const { run } = harness()
    await run('say something worth keeping', at)
    const out = text((await run('newcomr', at)).lines)

    // The only confirmation used to be the question changing.
    expect(out).toMatch(/newcomr, then/)
    expect(out).toMatch(/type back/)
  })

  it('goes back to the name question with the sentence still held', async () => {
    const { run, posted, session } = harness()
    const sentence = 'the thing i would hate to retype'

    await run(`say ${sentence}`, at)
    await run('newcomr', at)
    const back = text((await run('back', at)).lines)

    expect(back).toMatch(/nothing was made/)
    expect(back).toMatch(/newcomr is still free/)
    expect(back).toMatch(/what do you want to be called\?/)
    expect(session.isAsking()).toBe(true)

    // And the whole flow still completes, with the sentence nobody retyped.
    await run('newcomer', at)
    await run('newcomer@example.com', at)
    expect(session.name()).toBe('newcomer')
    expect(posted).toEqual([{ room: 'music', body: sentence }])
  })

  it('does not create anything under the name it went back from', async () => {
    const { run, session } = harness()
    await run('say hello', at)
    await run('wrongname', at)
    await run('back', at)
    await run('rightname', at)
    await run('rightname@example.com', at)

    expect(session.name()).toBe('rightname')
  })

  it('accepts the words somebody actually types when they realise', async () => {
    for (const word of ['back', 'oops', 'wait', 'rename', 'no']) {
      const { run, session } = harness()
      await run('say hello', at)
      await run('newcomr', at)
      const out = text((await run(word, at)).lines)
      expect(out, word).toMatch(/what do you want to be called\?/)
      expect(session.name(), word).toBeNull()
    }
  })

  it('leaves those words usable as names, where they are names', async () => {
    // The name question must not intercept them. Doing so is the bug that made
    // accounts called `look`, and `back` is a name somebody may well want.
    const { run, session } = harness()
    await run('say hello', at)
    await run('back', at)
    await run('back@example.com', at)
    expect(session.name()).toBe('back')
  })

  it('names the way out when the email does not parse', async () => {
    const { run } = harness()
    await run('say hello', at)
    await run('newcomr', at)
    const out = text((await run('not-an-email', at)).lines)
    expect(out).toMatch(/doesn’t look like an email/)
    expect(out).toMatch(/type back/)
  })
})


describe('agreeing to the terms, at the one moment there is', () => {
  it('says what sending the address does, before it is sent', async () => {
    const { run } = harness()
    await run('say something', { room: 'music' })
    const out = text((await run('newcomer', { room: 'music' })).lines)

    expect(out).toContain('means you agree to the terms')
    expect(out).toContain('type terms')
  })

  it('lets you read either document without losing your place', async () => {
    /*
     * The email question already said `type privacy for what's kept`, and that
     * instruction did not work: mid-signup everything typed is an answer, so it
     * came back as "that doesn't look like an email address". An instruction the
     * product refuses is worse than none, and the terms line made it two.
     */
    const { run } = harness()
    await run('say something', { room: 'music' })
    await run('newcomer', { room: 'music' })

    for (const document of ['terms', 'privacy']) {
      const out = text((await run(document, { room: 'music' })).lines)
      expect(out, document).not.toContain('doesn’t look like an email address')
      // And the question is asked again, since a document is long enough to
      // have pushed it off the screen.
      expect(out, document).toContain('where should i send your key?')
    }
  })

  it('still takes the address afterwards, with the sentence still held', async () => {
    const { run, posted } = harness()
    await run('say a thing worth keeping', { room: 'music' })
    await run('newcomer', { room: 'music' })
    await run('terms', { room: 'music' })

    const done = await run('newcomer@example.com', { room: 'music' })
    expect(done.identity).toBe('newcomer')
    expect(posted).toEqual([{ room: 'music', body: 'a thing worth keeping' }])
  })

  it('does not spend a name on a document at the name question', () => {
    // `terms` is a perfectly good name, and intercepting it where names are
    // taken is the bug that once made people's accounts `look`.
    expect(validateName('terms')).toMatchObject({ ok: true })
    expect(validateName('privacy')).toMatchObject({ ok: true })
  })
})


describe('what a post number is for, and where there isn’t one', () => {
  /*
   * A screenshot of commons, with the question that came with it: "i'm not
   * seeing any numbers next to these posts. don't i need to type a number to
   * open it so i can reply? but it tells me the post number when i'm the one
   * sending it."
   *
   * Both halves were right. Commons shows no numbers because §3.10 gives it
   * none to show — and the confirmation announced one anyway.
   */
  it('does not announce a number in commons, where a number means nothing', async () => {
    const { run } = harness({ me: 'ryan' })
    const out = text((await run('say good to be here', { room: 'commons' })).lines)

    /*
     * A word, and only here — commons is the one place with no address to give
     * instead. It went to nothing at all for a while, on the rule that success
     * prints a value or prints nothing; from real use, "instead of just LOOKING
     * like it's sent" is what nothing reads as, and commons is where that bites
     * hardest because your own words never arrive back down the live channel
     * either.
     *
     * Still no number: `go 26` in commons answers "there's nothing to open
     * here", so naming 26 would point at a door that is not there.
     */
    expect(out).toBe('said.')
    expect(out).not.toMatch(/\d/)
  })

  it('prints the address in a room that keeps things, and nothing else', async () => {
    const { run } = harness({ me: 'ryan' })
    const lines = (await run('say found my dad’s records', { room: 'music' })).lines

    // The first line is the address and only the address — no verb, no status
    // word. `said.` was a delivery receipt, and success does not need one.
    expect(lines[0].text).toBe('music/42')
    expect(text(lines)).not.toMatch(/said/)
  })

  it('prints the whole address, not a bare number', async () => {
    // A lone `42` under a sentence is cryptic, and `go 42` only works while you
    // are standing in the room it belongs to. What is printed is what `go`
    // takes from anywhere, which is what every other listing prints too.
    const { run } = harness({ me: 'ryan' })
    const lines = (await run('say hello', { room: 'music' })).lines
    expect(lines[0].text).toBe('music/42')
    expect(lines[0].text).not.toBe('42')
  })

  it('explains what the number is for once, and then stops', async () => {
    /*
     * "When I send a message it says 'go 5 to see the replies' under it, and
     * it's happening each time — that's cluttering things."
     *
     * Both halves of that are right, and they were both caused by one line
     * doing two jobs. The number is information and belongs on every post; the
     * sentence explaining what a number is for is teaching, and teaching that
     * repeats is nagging. It was two lines of furniture under everything
     * anybody wrote.
     */
    const { run } = harness({ me: 'ryan' })
    const first = text((await run('say found my dad’s records', { room: 'music' })).lines)
    const second = text((await run('say and a working turntable', { room: 'music' })).lines)
    const third = text((await run('say two of them actually', { room: 'music' })).lines)

    expect(first).toMatch(/that’s where it lives/)
    expect(second).not.toMatch(/opens it/)
    expect(third).not.toMatch(/opens it/)

    // The address itself is not the part that was clutter. It stays.
    expect(second).toMatch(/music\/\d+/)
    expect(third).toMatch(/music\/\d+/)
  })

  it('counts a wall post as having explained it too', async () => {
    // Two branches print the line — a room and a wall — and suppressing only
    // the one you tested leaves the other saying it forever.
    const { run } = harness({ me: 'ryan' })
    const first = text((await run('say hello', { room: '~ryan' })).lines)
    // Or this passes because the wall post failed and printed nothing at all.
    expect(first).toMatch(/~ryan\/\d+ opens it/)

    const second = text((await run('say again', { room: 'music' })).lines)
    expect(second).not.toMatch(/opens it/)
  })

  it('holds that fact with the sentence, across the two signup questions', async () => {
    /*
     * The path the e2e suite caught and this one had missed: the first thing
     * anybody writes is posted by the signup flow, not by `say`, and usually in
     * commons. Working it out at landing time is too late — by then the only
     * thing that knew has been two questions ago.
     */
    const { run } = harness()
    await run('say good to be here', { room: 'commons' })
    await run('ryan', { room: 'commons' })
    const out = text((await run('ryan@example.com', { room: 'commons' })).lines)

    // The held sentence landed in commons, so there is no address to print —
    // and the line above it has to still read as finished on its own.
    expect(out).toMatch(/the thing you were trying to say is up/)
    expect(out).not.toMatch(/commons\/\d+/)
  })

  it('still gives the address when the held sentence lands in a keeping room', async () => {
    const { run } = harness()
    await run('say found my dad’s records', { room: 'music' })
    await run('ryan', { room: 'music' })
    const out = text((await run('ryan@example.com', { room: 'music' })).lines)

    expect(out).toMatch(/music\/\d+/)
    expect(out).toMatch(/that’s where it lives/)
  })

  it('answers a reply with the address of the post it is under', async () => {
    /*
     * §4.3 gives a reply no address of its own, and the post's is the true
     * answer to "where did that go" — it is also what you would type to come
     * back and read the thread. Printing nothing was the previous version, and
     * nothing is exactly what "it doesn't look like it sent" is made of.
     */
    const { run } = harness({ me: 'ryan' })
    const out = text((await run('say i agree', { room: 'music', postId: 12 })).lines)
    expect(out).toBe('music/12')
  })
})

describe('help does not offer what commons cannot do', () => {
  it('leaves reply out of commons, where it can never work', async () => {
    const { run } = harness()
    const out = text((await run('help', { room: 'commons' })).lines)

    expect(out).not.toMatch(/^reply — /m)
    // Still listed where it is one step from working.
    expect(text((await run('help', { room: 'music' })).lines)).toMatch(/^reply — /m)
  })

  it('still explains itself when somebody types it there anyway', async () => {
    const { run } = harness()
    const out = text((await run('reply nice one', { room: 'commons' })).lines)
    expect(out).toContain('commons doesn’t keep replies')
    expect(out).toContain('say it as its own thing')
  })

  it('does not offer to open a post in a room that has none', async () => {
    const { run } = harness()
    const out = text((await run('help', { room: 'commons' })).lines)

    expect(out).toMatch(/^go — go to another room$/m)
    expect(out).not.toMatch(/^go — open a post$/m)
  })
})
