/**
 * THE table.
 *
 * Verb, aliases, gloss, detail, valid contexts and handler all live here, and
 * the palette (§3.6), `help`, `what` (§3.8) and the fuzzy suggestions in errors
 * (§3.7) are every one of them derived from it. Nothing about a command is
 * written down twice — which is what stops the §3.5 alias table from drifting
 * away from the glossary users actually read.
 *
 * §3.5: English verbs are canonical, Unix names are aliases. Terminal-literate
 * users type the short forms and feel clever; everyone else never learns there
 * was a joke. Aliasing is never announced.
 */

import { parseFlags, parseSince, splitStages } from '@/lib/commands/pipeline'
import type { Env } from '@/lib/shell/env'
import { formatAgo, type PostHit, type PostQuery, type RoomHit } from '@/lib/shell/model'
import { renderPost, renderProfile, renderRoom, renderRoomList } from '@/lib/shell/render'
import type { Session } from '@/lib/shell/session'
import { ABOUT_SUMMARY } from '@/lib/guide/about'
import { PRIVACY, TERMS } from '@/lib/legal/documents'
import { offerInstall } from '@/lib/pwa/install'
import { DEFAULT_THEME, THEMES, findTheme } from '@/lib/shell/themes'
import { pathToLocation } from '@/lib/shell/types'
import type { Context, Line, Location, RunResult } from '@/lib/shell/types'

export interface HandlerArgs {
  arg: string
  location: Location
  context: Context
  env: Env
  /**
   * A real room slug, for errors that name the fix — resolved only if asked.
   *
   * Eagerly computing this made every command a database round trip for a
   * value most handlers never read, and meant `help` and `what` — the two
   * commands a confused person reaches for, which need no data at all — broke
   * whenever the database did.
   */
  hint: () => Promise<string>
  /** Who you are, and the machinery that asks if you aren't anyone yet (§3.9). */
  session: Session
}

export type Handler = (args: HandlerArgs) => Promise<RunResult>

export interface Command {
  verb: string
  aliases: readonly string[]
  /**
   * §4.8 — kept out of `help`, the palette and the "did you mean" pool, so it
   * is found by curiosity rather than advertised. `what posts` still explains
   * it in full, which is the whole of its documentation.
   */
  hidden?: boolean
  /** Opts into `|` splitting. Without it, a pipe is just a character. */
  pipeable?: boolean
  /** `verb — what it does`, phrased for where you are standing. */
  gloss: (context: Context) => string
  /** Plain English, for `what <command>` (§3.8). */
  detail: (context: Context) => string
  /** Where the command means anything. */
  contexts: readonly Context[]
  /** What a chip puts in the prompt; trailing space when an argument follows. */
  insert: (context: Context) => string
  /** §3.7 — used from the wrong place, name the fix. Never "invalid syntax". */
  wrongContext: (context: Context, hint: string) => string
  run: Handler
}

/**
 * `person` is in here and not in `say`'s list, which is the whole of §3.10's
 * enforcement: a profile is somewhere you can read, search and leave from, and
 * the one thing you cannot do is contribute to it.
 */
const ALL: readonly Context[] = ['lobby', 'room', 'commons', 'post', 'person']

const THEME_KEY = 'thewall.theme'

function readTheme(): string {
  if (typeof document === 'undefined') return DEFAULT_THEME
  return document.documentElement.dataset.theme ?? DEFAULT_THEME
}

function applyTheme(name: string): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = name
  try {
    localStorage.setItem(THEME_KEY, name)
  } catch {
    // Private browsing, or storage full. The theme still applies for this
    // session; it simply will not be remembered, which is not worth a message.
  }
}

const error = (text: string): RunResult => ({ lines: [{ text, tone: 'error' }] })

/** Matches the `limit` in `public.mail()`. Reaching it is said out loud. */
const MAIL_LIMIT = 100

/** A post address that exists, for an error that tells you to open one. */
async function newestPostIn(env: Env, room: string | undefined): Promise<number | string> {
  if (room === undefined) return 12
  try {
    const found = await env.getRoom(room)
    return found?.posts[0]?.id ?? 12
  } catch {
    return 12
  }
}

/** One line of `doctor`, aligned so a column of them can be read down. */
function row(label: string, ok: boolean, note = ''): Line {
  return {
    text: `${ok ? '  ' : '! '}${label.padEnd(30)} ${note}`,
    tone: ok ? 'dim' : 'error',
  }
}

export const COMMANDS: readonly Command[] = [
  {
    verb: 'look',
    aliases: ['ls', 'see', 'list', 'show', 'rooms'],
    contexts: ALL,
    gloss: (c) =>
      c === 'lobby'
        ? 'see what’s around you'
        : c === 'post'
          ? 'read it again'
          : c === 'person'
            ? 'what they’ve said'
            : 'see what’s here',
    detail: () =>
      'shows you what’s around you. at the lobby that’s the rooms, inside a room it’s the posts, inside a post it’s the replies.',
    insert: () => 'look',
    wrongContext: () => '',
    async run({ context, location, env }) {
      if (context === 'lobby') return { lines: renderRoomList(await env.listRooms()) }

      if (context === 'person') {
        const profile = await env.getProfile(location.person!)
        if (!profile) return error(`there’s no one called ${location.person}. try: leave`)
        return { lines: renderProfile(profile) }
      }

      const room = await env.getRoom(location.room!)
      if (!room) return error(`${location.room} isn’t there anymore. try: leave`)

      if (context === 'post') {
        const post = await env.getPost(room.slug, location.postId!)
        if (!post) return error(`post ${location.postId} isn’t there anymore. try: leave`)
        return { lines: renderPost(post) }
      }
      return { lines: renderRoom(room) }
    },
  },

  {
    verb: 'go',
    aliases: ['cd', 'enter', 'open', 'join', 'read'],
    contexts: ALL,
    gloss: (c) =>
      c === 'lobby' || c === 'person'
        ? 'enter a room'
        : // Commons has no posts to open (§3.10), so offering to open one is
          // the palette naming something that cannot happen. Naming a room is
          // what `go` is actually for from here.
          c === 'commons'
          ? 'go to another room'
          : 'open a post',
    detail: () =>
      'moves you. at the lobby, go music. inside a room, go 12 opens that post. a whole address works from anywhere — go music/12 — and so does go ~marisol, which shows you somebody: their page, and their wall.',
    insert: () => 'go ',
    wrongContext: () => '',
    async run({ arg, context, location, env, hint }) {
      if (arg === '') {
        return error(
          context === 'lobby' || context === 'commons'
            ? `go where? try: go ${await hint()}`
            : context === 'person'
              ? `go where? try: go ${await hint()}`
              : 'go where? try: go 12, or the name of a room.',
        )
      }

      /*
       * `music/12` and `~marisol/2` — a whole address, typed in one go.
       *
       * This is what `find`, `mail` and a profile all print, so it was always
       * the obvious thing to type back and it always failed. Walls made the
       * failure worse rather than new: `go ~marisol/2` fell into the tilde
       * branch below and answered "there's no one called marisol/2", which is
       * an error about the wrong thing entirely.
       */
      if (arg.includes('/')) {
        const target = pathToLocation(`/${arg}`)
        if (target.room !== undefined && target.postId !== undefined) {
          const post = await env.getPost(target.room, target.postId)
          if (!post) return error(`there’s nothing at ${arg}. try: go ${target.room}`)
          return { lines: renderPost(post), location: target }
        }
      }

      // `~marisol` is somebody, not somewhere. §3.10 warns that a space which
      // absorbs activity "deletes the geography that makes this feel like a
      // place", so this resolves to a view: their posts, each still carrying
      // the room and id it lives at, and nothing on it postable.
      if (arg.startsWith('~')) {
        const who = arg.slice(1).toLowerCase()
        if (who === '') return error('go who? try: go ~marisol')

        const profile = await env.getProfile(who)
        if (!profile) {
          const { names } = await env.who(location.room)
          const near = nearestSlug(who, names)
          return error(
            near
              ? `there’s no one called ${who}. did you mean ~${near}?`
              : `there’s no one called ${who}. try: who`,
          )
        }
        return { lines: renderProfile(profile), location: { person: profile.name } }
      }

      // A bare number is a post address, and post addresses only exist inside
      // rooms that keep things (§3.4, §3.10).
      if (/^\d+$/.test(arg)) {
        const id = Number(arg)
        // On a profile a bare number is their wall — the one place a person
        // does have addresses of their own now.
        if (context === 'person') {
          const post = await env.getPost(`~${location.person}`, id)
          if (!post) {
            return error(`there's nothing at ${id} on ${location.person}'s wall. try: look`)
          }
          return {
            lines: renderPost(post),
            location: { room: `~${location.person}`, postId: id },
          }
        }
        if (context === 'lobby') {
          return error(`post numbers only work inside a room. try: go ${await hint()} first.`)
        }
        if (context === 'commons') {
          return error('commons doesn’t keep posts, so there’s nothing to open here.')
        }
        const post = await env.getPost(location.room!, id)
        if (!post) return error(`there’s no post ${id} in ${location.room}. try: look`)
        return { lines: renderPost(post), location: { room: location.room, postId: id } }
      }

      // Anything else is a room name, and naming a room works from anywhere —
      // the same way an absolute path does.
      const room = await env.getRoom(arg)
      if (!room) {
        // Somebody's name typed as though it were a room is the commonest way
        // anyone will discover profiles exist, so the error teaches the tilde
        // rather than just reporting a miss (§3.7).
        const person = await env.getProfile(arg)
        if (person) {
          return error(`there’s no room called ${arg}. ${arg} is a person — try: go ~${arg}`)
        }

        const rooms = await env.listRooms()
        const near = nearestSlug(
          arg,
          rooms.map((r) => r.slug),
        )
        return error(
          near ? `there’s no room called ${arg}. did you mean ${near}?` : `there’s no room called ${arg}. try: look`,
        )
      }
      return { lines: renderRoom(room), location: { room: room.slug } }
    },
  },

  {
    /*
     * §4.2, reopened. The doc closes room creation — "a fixed, curated set at
     * launch" — on the grounds that "40 rooms with three people each kills the
     * entire feeling". That is a warning about the *lobby*, not about how many
     * rooms exist, and the lobby is defended where it lives: curated rooms
     * first, user rooms only while somebody is in them.
     *
     * The name and the gloss are one line, deliberately. A second question
     * would make this the only place on the site that interrupts you to fill in
     * a form, and §3.9's whole shape is that friction lands once, at the moment
     * you have already decided.
     */
    verb: 'make',
    aliases: ['create', 'new', 'mkdir', 'open-room'],
    contexts: ALL,
    gloss: () => 'start a new room',
    detail: () =>
      'makes a room: make garden what you are growing. the first word is its name, the rest says what it is for and shows under it in the lobby. you need a verified account, and you can make three a week. a room has no owner — once it exists it is everybody\u2019s.',
    insert: () => 'make ',
    wrongContext: () => '',
    async run({ arg, env, session }) {
      const [slug = '', ...rest] = arg.trim().split(/\s+/)
      const gloss = rest.join(' ')

      if (slug === '') {
        return error('make what? try: make garden')
      }
      if (session.name() === null) {
        return error('you need a name first. say something anywhere and i’ll ask you for one.')
      }

      const open = async (line: string): Promise<RunResult> => {
        const made = await env.makeRoom(slug, line)
        if (!made.ok) return error(made.reason)

        const room = await env.getRoom(made.slug)
        return {
          lines: [
            { text: `${made.slug} is open. you are in it.`, tone: 'accent' },
            { text: '' },
            ...(room
              ? renderRoom(room)
              : [{ text: 'nothing here yet. say something and it will be the first thing.', tone: 'faint' as const }]),
            { text: '' },
            // Said once, at the only moment it is useful: a room with nothing
            // in it drops out of the lobby, and §5 is blunt about an empty room
            // being worse than no room.
            { text: 'it stays in the lobby while people are talking in it. it is always reachable by name.', tone: 'faint' },
          ],
          location: { room: made.slug },
        }
      }

      /*
       * No gloss on the line, so ask for one — rather than refusing and telling
       * somebody to type what they just typed with more on the end.
       *
       * That refusal read as a syntax error, which §3.7 says nothing here may
       * be, and its example was worse than the refusal: `make onions what you
       * are growing` filled in a description belonging to a different room, and
       * it was copied verbatim, because an example you are told to try is an
       * instruction. A room ended up called onions and glossed "what you are
       * growing" — the error wrote it.
       *
       * The prompt already knows how to ask; that is the whole of signup (§3.9).
       * One line on the same line still works for anybody who prefers it.
       */
      if (gloss === '') {
        return {
          lines: session.askOne(
            [
              { text: `what is ${slug} for?`, tone: 'accent' },
              { text: 'a few words. it goes under the name in the lobby, and it is how people know what to put there.', tone: 'faint' },
            ],
            async (answer) => {
              const result = await open(answer)
              return { lines: result.lines, location: result.location }
            },
          ),
        }
      }

      return open(gloss)
    },
  },

  {
    verb: 'say',
    aliases: ['wall', 'post', 'write', 'talk'],
    /*
     * §3.3 — one verb for all contribution, and `say` is still it: inside a
     * post this is what adds a reply. `reply` used to be an alias here, which
     * was worse than not having it. Aliases are never announced (§3.5), so
     * nobody could find it — and in a *room* it resolved to this and posted a
     * brand new post, which is the opposite of what somebody typing "reply"
     * wants. It is a command of its own below, and does nothing this cannot.
     */
    contexts: ['room', 'commons', 'post', 'person'],
    gloss: (c) =>
      c === 'post'
        ? 'reply here'
        : c === 'commons'
          ? 'say something'
          : c === 'person'
            // "your own" rather than "your", because `help` prints this from
            // somebody else's page too, where only they may start something.
            ? 'post on your own wall'
            : 'post something here',
    detail: () =>
      'contributes wherever you’re standing. in a room it starts a new post; inside a post it adds a reply; on your own page it goes on your wall, where anybody can answer it.',
    insert: () => 'say ',
    // §3.7 — the canonical example: name the fix, don't report a failure.
    wrongContext: (_c, hint) => `you have to be in a room first. try: go ${hint}`,
    async run({ arg, context, location, env, session }) {
      if (arg === '') {
        return error(
          context === 'post' ? 'say what? try: say i agree' : 'say what? type say and then your sentence.',
        )
      }

      /*
       * A wall is a room, so this is the ordinary write path with the room
       * named for you — which is the whole reason walls were built that way.
       * Somebody else's wall is theirs to start things on; you can answer what
       * is already there, which is what makes it a wall and not a diary.
       */
      if (context === 'person') {
        /*
         * Ownership is checked before the name is, and that order is the whole
         * of it. A page only exists for somebody who exists, so a visitor with
         * no name is never standing on their own wall — asking them to sign up
         * here would collect a name in exchange for a sentence the wall is then
         * going to refuse, which is §3.9's promise turned into a trap.
         */
        if (location.person !== session.name()) {
          // Named against the wall itself, so "go 2" is a post that is really
          // there. An empty wall has nothing to point at, and inventing a
          // number would be an instruction that fails when followed (§3.7).
          const wall = await env.getRoom(`~${location.person}`).catch(() => undefined)
          const example = wall?.posts[0]?.id
          return error(
            example === undefined
              ? `this is ${location.person}'s wall — only they can put things on it, and there's nothing here to answer yet.`
              : `this is ${location.person}'s wall — only they can put things on it. you can answer what's here: go ${example}`,
          )
        }
        const onWall = await session.write({ room: `~${location.person}` }, arg)
        return { lines: onWall.lines, retry: onWall.failed ? arg : undefined }
      }

      // §3.9 — the sentence is captured first, then the account is asked for.
      // Friction lands at peak motivation, and nothing typed is ever lost.
      if (session.name() === null) {
        return {
          lines: session.begin({ location, body: arg, addressed: context !== 'commons' }),
        }
      }

      const written = await session.write(location, arg, { addressed: context !== 'commons' })
      // §3.9 — nothing typed is ever lost, including to a network blip.
      return { lines: written.lines, retry: written.failed ? arg : undefined }
    },
  },

  {
    /*
     * Not a second way to contribute — inside a post this is `say`, exactly.
     * It exists because §3.3's "there is no reply verb to learn" turned out to
     * cost more than it saved: the one thing everybody wants to do second is
     * answer somebody, `say` only reads as "reply" once you are already inside
     * a post, and an alias is invisible by design. So the word people reach for
     * is a command, which means it appears in `help` from everywhere and
     * teaches the step they are missing.
     */
    verb: 'reply',
    aliases: ['re', 'answer'],
    /*
     * Everywhere except commons.
     *
     * `help` lists what you can type from where you are standing, so a verb
     * that is listed and always fails is the same defect as a palette chip that
     * always fails. In the lobby or on somebody's page `reply` is a step away
     * from working — go to a room, open a post — and saying so teaches the
     * step. In commons it can never work at all: §3.10 gives it no threads and
     * a trigger in the schema refuses replies there. So it is not offered, and
     * typing it still gets the sentence that explains why.
     */
    contexts: ['lobby', 'room', 'post', 'person'],
    // No dash inside a gloss: help renders `verb — gloss`, and a second one
    // turns the line into a puzzle.
    gloss: (c) => (c === 'post' ? 'answer this' : 'answer a post, once you open it'),
    detail: () =>
      'answers somebody. replies live inside a post, so open one first: go 12, then reply. inside a post this and say are the same thing. commons is the exception — nothing there keeps replies.',
    insert: (c) => (c === 'post' ? 'reply ' : 'go '),
    // Only ever commons, since that is the only context left out above.
    wrongContext: () => 'commons doesn’t keep replies — say it as its own thing instead.',
    async run(args) {
      const { context, location, env } = args

      // Inside a post this *is* say — looked up rather than duplicated, so
      // there is exactly one contribution path and §3.9's held-sentence
      // machinery cannot be bypassed by a second door onto it.
      if (context === 'post') return findCommand('say')!.run(args)

      // §3.7 — name the fix, and name a real one. A post that is actually
      // there beats an invented number, which is the difference between an
      // instruction somebody can follow and one they have to decode.
      const example = await newestPostIn(env, location.room)
      return error(
        context === 'person'
          ? `replies live inside a post. open one of ${location.person}'s first — try: go 1`
          : context === 'lobby'
            ? 'replies live inside a post. go to a room first, then open one.'
            : `replies live inside a post. open one first — try: go ${example}`,
      )
    },
  },

  {
    verb: 'who',
    aliases: ['people', 'online', 'users'],
    contexts: ALL,
    gloss: () => 'who’s around',
    detail: () => 'lists who’s around right now.',
    insert: () => 'who',
    wrongContext: () => '',
    async run({ location, env, session }) {
      const { names, guests } = await env.who(location.room)

      const lines: Line[] = [
        names.length > 0
          ? { text: names.join(', '), tone: 'dim' }
          : { text: 'nobody signed in right now.', tone: 'faint' },
      ]

      if (guests > 0) {
        lines.push({
          text: `and ${guests} ${guests === 1 ? 'person' : 'people'} reading without a name.`,
          tone: 'faint',
        })
      }

      // §3.9 — guest state is ambient, never nagging, but `who` says why.
      if (session.name() === null) {
        lines.push({
          text: 'you’re one of them — say something and you’ll be on the list.',
          tone: 'faint',
        })
      }
      return { lines }
    },
  },

  {
    verb: 'leave',
    aliases: ['back', 'exit', 'up'],
    // §3.1 — backs out one level, always, from anywhere.
    contexts: ALL,
    gloss: (c) => (c === 'post' ? 'back to the room' : 'back to the lobby'),
    detail: () => 'backs you out one level, from anywhere. from somebody’s page, back to the lobby.',
    insert: () => 'leave',
    wrongContext: () => '',
    async run({ context, location, env }) {
      if (context === 'lobby') {
        return { lines: [{ text: 'you’re already at the lobby.', tone: 'faint' }] }
      }
      if (context === 'post') {
        const room = await env.getRoom(location.room!)
        if (!room) return { lines: renderRoomList(await env.listRooms()), location: {} }

        /*
         * Backing out of a wall post lands on the person, not on `{room:
         * '~marisol'}`. Both would print `~marisol` in the prompt and both
         * would be `/~marisol` in the URL — and a reload would come back as
         * the person, because that is what the path parses to. One address
         * cannot mean two contexts, so the wall has exactly one of them.
         */
        if (room.owner !== undefined) {
          const profile = await env.getProfile(room.owner)
          if (profile) return { lines: renderProfile(profile), location: { person: profile.name } }
        }
        return { lines: renderRoom(room), location: { room: room.slug } }
      }
      return { lines: renderRoomList(await env.listRooms()), location: {} }
    },
  },

  {
    verb: 'what',
    aliases: ['man', 'explain', 'info', '?'],
    contexts: ALL,
    gloss: () => 'what a command does',
    detail: () => 'explains a command in plain english.',
    insert: () => 'what ',
    wrongContext: () => '',
    async run({ arg, context }) {
      if (arg === '') return error('what what? try: what go')

      const command = findCommand(arg)
      if (!command) {
        const near = nearestCommand(arg)
        return error(
          near
            ? `i don’t know "${arg}". did you mean ${near.verb} — ${near.gloss(context)}?`
            : `i don’t know "${arg}". try: help`,
        )
      }

      // §3.8 — plain English first, aliases second. This is where terminal
      // users find the shorthand and everyone else confirms they never needed it.
      const lines: Line[] = [
        { text: `${command.verb} — ${command.gloss(context)}`, tone: 'accent' },
        { text: command.detail(context), depth: 1 },
      ]
      if (command.aliases.length > 0) {
        lines.push({ text: `also: ${command.aliases.join(', ')}`, tone: 'faint', depth: 1 })
      }
      if (!command.contexts.includes(context)) {
        lines.push({ text: 'not from where you’re standing, though.', tone: 'faint', depth: 1 })
      }
      return { lines }
    },
  },

  {
    verb: 'help',
    aliases: ['commands', 'h'],
    contexts: ALL,
    gloss: () => 'everything you can type',
    detail: () => 'lists what you can type from where you are.',
    insert: () => 'help',
    wrongContext: () => '',
    async run({ context }) {
      /*
       * Two groups, not one list of fifteen.
       *
       * §3.6's argument is that a glossary teaches — but the list had grown to
       * fifteen lines in registry order, which at 380px means the bottom third
       * is below the fold, and it is the bottom third that had `terms` and
       * `privacy` in it. "I can't find how to get to the docs" is what that
       * looks like from outside: they were listed, thirteenth and fourteenth,
       * under a heading somebody had already stopped reading.
       *
       * So: what you do where you are standing, then a gap, then the ones about
       * you and about this place. The gap is the whole mechanism — it gives the
       * eye somewhere to stop, and it puts a short list at the top rather than a
       * wall.
       */
      const ELSEWHERE = ['about', 'mail', 'rename', 'theme', 'install', 'terms', 'privacy', 'what', 'help']

      const here: Line[] = []
      const about: Line[] = []

      for (const command of COMMANDS) {
        // §4.8 — the pipe is not on this list. That is the point of it.
        if (command.hidden || !command.contexts.includes(context)) continue
        const line: Line = { text: `${command.verb} — ${command.gloss(context)}`, tone: 'dim' }
        ;(ELSEWHERE.includes(command.verb) ? about : here).push(line)
      }

      const lines: Line[] = [{ text: 'from here you can type:', tone: 'faint' }, ...here]
      if (about.length > 0) {
        lines.push({ text: '' })
        lines.push({ text: 'and anywhere:', tone: 'faint' })
        lines.push(...about)
      }
      lines.push({ text: '' })
      lines.push({ text: 'what <command> explains any of them.', tone: 'faint' })
      return { lines }
    },
  },

  {
    /*
     * §8 makes the phone the kill condition, and installed is where a phone
     * stops fighting this design: full screen, no browser chrome resizing under
     * the keyboard, and an icon somebody can reach without typing an address.
     *
     * A command rather than a banner. The browser's own mini-infobar is
     * suppressed (see lib/pwa/install.ts) precisely so that this is asked for
     * rather than interrupted with — a bar across the top of a terminal is the
     * one interruption every other decision here has avoided.
     */
    verb: 'install',
    aliases: ['home', 'homescreen', 'app'],
    contexts: ALL,
    gloss: () => 'keep this on your home screen',
    detail: () =>
      'adds thewall to your home screen, so it opens full screen without the browser around it. on iphone the browser will not let a page do this, so it tells you which two taps to make instead.',
    insert: () => 'install',
    wrongContext: () => '',
    async run() {
      return { lines: await offerInstall() }
    },
  },

  {
    // §4.5 — the taste call, handed to whoever is looking. §9 flagged
    // green-on-black as the obvious choice worth departing from; this departs
    // from it by default and keeps it one word away.
    verb: 'theme',
    aliases: ['themes', 'colour', 'colours', 'color', 'colors'],
    contexts: ALL,
    gloss: () => 'change the colours',
    detail: () =>
      `changes how this looks, and remembers it on this device. ${THEMES.map((t) => t.name).join(', ')}. type theme on its own to see them.`,
    insert: () => 'theme ',
    wrongContext: () => '',
    async run({ arg }) {
      const current = readTheme()

      if (arg === '') {
        const lines: Line[] = THEMES.map((theme) => ({
          text: `${theme.name} — ${theme.gloss}${theme.name === current ? '   (yours)' : ''}`,
          tone: theme.name === current ? 'accent' : 'dim',
        }))
        lines.push({ text: `type theme ${THEMES[1].name} to change.`, tone: 'faint' })
        return { lines }
      }

      const chosen = findTheme(arg)
      if (!chosen) {
        const near = nearestSlug(arg, THEMES.map((t) => t.name))
        return error(
          near
            ? `there’s no ${arg} theme. did you mean ${near}?`
            : `there’s no ${arg} theme. try: theme`,
        )
      }

      applyTheme(chosen.name)
      return {
        lines: [{ text: `${chosen.name} — ${chosen.gloss}.`, tone: 'faint' }],
      }
    },
  },

  {
    // §4.1 — the reason anyone comes back. Its lean: "status bar shows the
    // count persistently; `mail` lists them with `go <id>` to jump. Pull-only,
    // no push, no email."
    verb: 'mail',
    aliases: ['replies', 'inbox', 'unread'],
    contexts: ALL,
    gloss: () => 'replies waiting for you',
    detail: () =>
      'shows replies to things you said, newest first, each with the address to walk to. reading them clears the count. nothing is pushed and nothing is emailed — it waits until you ask.',
    insert: () => 'mail',
    wrongContext: () => '',
    async run({ env, session }) {
      if (session.name() === null) {
        return {
          lines: [
            { text: 'no mail — you’re reading as a guest.', tone: 'faint' },
            { text: 'say something and replies to it will land here.', tone: 'faint' },
          ],
        }
      }

      const items = await env.readMail()
      if (items.length === 0) {
        return { lines: [{ text: 'nothing waiting.', tone: 'faint' }] }
      }

      const lines: Line[] = []

      // How many, before the list of them. The badge in the composer says
      // "you have 12 replies waiting" and then `mail` clears it — so without
      // this the number somebody was just told disappears at the moment they
      // act on it, and a long list arrives with nothing to measure it against.
      if (items.length > 1) {
        lines.push({ text: `${items.length} replies, newest first.`, tone: 'dim' })
        lines.push({ text: '' })
      }

      for (const item of items) {
        // The address first, because a notification you cannot walk to is just
        // an alert.
        lines.push({
          text: `${item.room}/${item.postId}  ${item.author}, ${formatAgo(item.createdAt)}`,
          tone: 'accent',
        })
        lines.push({ text: item.body, depth: 1 })
      }
      lines.push({ text: '' })

      // One step, not two. This said "go music then go 12" and carried a
      // comment claiming `go music/12` was not a thing — true when it was
      // written, and not since `go` learned to take a whole address, which is
      // the shape every listing on the site prints.
      lines.push({
        text: `go ${items[0].room}/${items[0].postId} to answer the newest.`,
        tone: 'faint',
      })

      // No silent caps. Reading is what marks mail read (§4.1 is pull-only), and
      // with newest-first ordering anything past the limit is older than
      // everything here — so hitting it clears replies that were never shown.
      // Rare, and not something to find out about by noticing a gap.
      if (items.length >= MAIL_LIMIT) {
        lines.push({
          text: `that is the newest ${MAIL_LIMIT}. anything older than these is cleared too — find --by=<name> still has it.`,
          tone: 'faint',
        })
      }

      return { lines, mail: 0 }
    },
  },

  {
    // §4.6, revised — as many renames as you like.
    //
    // The document leaned one ever, with the old name reserved forever so
    // nobody could impersonate. Unlimited is the right half to change: "someone
    // who picks badly at 2am is stuck with it" is not a once-in-a-lifetime
    // event, and a cap only moves the trap along by one.
    //
    // Releasing the old name immediately is the half that costs something, so
    // the handler says so out loud rather than letting people find out later.
    verb: 'rename',
    aliases: ['name', 'callme'],
    contexts: ALL,
    gloss: () => 'change my name',
    detail: () =>
      'changes what you are called, as often as you like. everything you have said follows the new name, and the old one goes free for anyone to take the moment you drop it — so do not release a name you want back.',
    insert: () => 'rename ',
    wrongContext: () => '',
    async run({ arg, session }) {
      if (arg === '') {
        const current = session.name()
        return error(
          current === null
            ? 'you don’t have a name yet. say something and i’ll ask you for one.'
            : `you’re ${current}. rename to what? try: rename ${current}_`,
        )
      }
      const { lines, identity } = await session.rename(arg)
      return { lines, identity }
    },
  },

  {
    /*
     * The one command whose audience is somebody who does not yet know what
     * they are looking at.
     *
     * `help` answers "what can I type" and `what` answers "what does this do",
     * and neither answers "what is this place". Somebody who lands on a command
     * prompt on a social site has that question first, and until now the only
     * answer was to work it out.
     *
     * The short version prints here; the whole rundown is a page, for the same
     * reason the policies are — it has to be readable by somebody who has not
     * typed anything yet, or who arrived from a link somebody sent them.
     */
    verb: 'about',
    aliases: ['guide', 'intro', 'wtf', 'readme'],
    contexts: ALL,
    gloss: () => 'what this place is',
    detail: () =>
      'explains what thewall is, why the whole thing is a prompt, and how the pieces fit. the short version prints here; the whole rundown is at thewall.social/about.',
    insert: () => 'about',
    wrongContext: () => '',
    async run() {
      return { lines: ABOUT_SUMMARY.map((text) => ({ text, tone: 'faint' as const })) }
    },
  },

  {
    // Not hidden, and not a footer. A policy nobody can find is not published,
    // and the moment somebody is asked for an email address is exactly the
    // moment they are owed a way to read what happens to it — so the signup
    // question names this command directly.
    verb: 'privacy',
    aliases: ['data'],
    contexts: ALL,
    gloss: () => 'what’s kept about you',
    detail: () =>
      'what thewall holds about you, why, who else can see it, and how to have it deleted. the whole policy is at thewall.social/privacy.',
    insert: () => 'privacy',
    wrongContext: () => '',
    async run() {
      return { lines: PRIVACY.summary.map((text) => ({ text, tone: 'faint' as const })) }
    },
  },

  {
    verb: 'terms',
    aliases: ['tos', 'rules'],
    contexts: ALL,
    gloss: () => 'the deal, briefly',
    detail: () =>
      'what you agree to by using this, what not to post, and what happens if you do. the whole thing is at thewall.social/terms.',
    insert: () => 'terms',
    wrongContext: () => '',
    async run() {
      return { lines: TERMS.summary.map((text) => ({ text, tone: 'faint' as const })) }
    },
  },

  {
    /*
     * §7 — the operator's day one, for the half that lives in a browser.
     *
     * Hidden, like the pipe and `resend`: nobody arriving here needs to know it
     * exists. It is written for the moment something is wrong and the screen is
     * saying a sentence that could mean three different things.
     *
     * The build line is the one that matters most. Twice, a code fix and an
     * unapplied migration and "that is not deployed yet" all presented as the
     * same message, and nothing on the page could tell them apart.
     */
    verb: 'doctor',
    aliases: ['diagnose', 'debug'],
    hidden: true,
    contexts: ALL,
    gloss: () => 'what is actually running',
    detail: () =>
      'reports the build, the origin, whether you are signed in, and which database updates this project is missing. for when something is wrong and the message could mean more than one thing.',
    insert: () => 'doctor',
    wrongContext: () => '',
    async run({ env }) {
      const lines: Line[] = [{ text: 'what is actually running:', tone: 'faint' }]

      const build = process.env.NEXT_PUBLIC_BUILD ?? 'unknown'
      const branch = process.env.NEXT_PUBLIC_BRANCH ?? ''
      lines.push(row('build', true, branch ? `${build} on ${branch}` : build))

      if (typeof window !== 'undefined') {
        const site = process.env.NEXT_PUBLIC_SITE_URL ?? ''
        const here = window.location.origin
        lines.push(row('here', true, here))
        // A mismatch is why a magic link can sign you in on one origin and
        // leave you a guest on the other: the cookie belongs to whichever host
        // the callback ran on.
        lines.push(
          row(
            'site url',
            site === here,
            site === '' ? 'not set' : site === here ? site : `${site} — does not match`,
          ),
        )
      }

      const checks = await env.diagnose()
      for (const check of checks) {
        lines.push(row(check.label, check.ok, check.note))
      }

      const missing = checks.filter((check) => check.note === 'NOT APPLIED').length
      if (missing > 0) {
        lines.push({ text: '' })
        lines.push({
          text: `${missing} database update${missing === 1 ? '' : 's'} missing — run scripts/db-deploy.sh`,
          tone: 'error',
        })
      }

      return { lines }
    },
  },

  {
    // §4.7 — hidden like the pipe, but for a different reason: nobody needs to
    // know it exists until the moment they do, and the message that asks them
    // to verify names it directly.
    verb: 'resend',
    aliases: ['verify', 'key'],
    hidden: true,
    contexts: ALL,
    gloss: () => 'send my key again',
    detail: () =>
      'sends another sign-in link to your address. the one from signup expires, and you need a followed link to keep your name and keep posting.',
    insert: () => 'resend',
    wrongContext: () => '',
    async run({ session }) {
      return { lines: await session.resendKey() }
    },
  },

  {
    // §3.5 says the English verb is canonical, and searching is a verb — but
    // `posts` stays as an alias because it is the name §4.8 uses, and because
    // `posts --by=x | count` reads better than `find` does as a pipe source.
    //
    // Not hidden. §4.8's lean is that the *pipe* is documented only inside
    // `what find` — hiding the search itself was over-applying it, and a search
    // nobody can discover is barely a search.
    verb: 'find',
    aliases: ['posts', 'search', 'grep'],
    pipeable: true,
    contexts: ALL,
    gloss: () => 'find something that was said',
    detail: () =>
      'looks for words in what people have said, everywhere or just here: find tomatoes. narrow it with --room, --by, --since or --limit. results can be piped: find --by=jameson --since=7d | count, or | go to open the newest.',
    insert: () => 'find ',
    wrongContext: () => '',
    async run({ arg, location, env }) {
      // Only this command splits on `|`. That is why `say i love a|b` keeps
      // its pipe instead of becoming half a sentence and a broken pipeline.
      const [source = '', ...rest] = arg.split('|')
      const sinks = splitStages(rest.join('|'))

      /*
       * `find --rooms cycling` answers a different question from `find
       * cycling`, and it became a question worth answering the moment rooms
       * were something people make: the lobby stopped being the list of what
       * is here. Name and gloss both, because half the time you remember what
       * a room was *for* rather than what it was called.
       */
      // `--rooms`, exactly. Written `--rooms?` first, which also matched
      // `--room=music` and quietly hijacked the filter that has always existed
      // — every `find --room=x` became a room search returning the wrong shape.
      if (/(^|\s)--rooms(\s|=|$)/.test(source)) {
        if (sinks.length > 0) return error('rooms don’t pipe yet. try: find --rooms garden')
        const term = source.replace(/(^|\s)--rooms(=\S*)?/g, ' ').trim()
        return { lines: renderRoomHits(await env.findRooms(term), term) }
      }

      const query = buildQuery(source, location)
      if ('problem' in query) return error(query.problem)

      const hits = await env.searchPosts(query.query)

      if (sinks.length === 0) {
        // Nothing was *said* about it — but it may be the name of a room, and
        // that is the likeliest thing somebody typing one word meant (§3.7).
        if (hits.length === 0 && query.query.text) {
          const rooms = await env.findRooms(query.query.text).catch(() => [])
          if (rooms.length > 0) {
            return {
              lines: [
                { text: `nothing said about ${query.query.text}.`, tone: 'faint' },
                { text: '' },
                ...renderRoomHits(rooms, query.query.text),
              ],
            }
          }
        }
        return { lines: renderHits(hits, query.query.text) }
      }
      if (sinks.length > 1) {
        return error('one pipe at a time for now. try: find --since=7d | count')
      }

      const sink = sinks[0].head.toLowerCase()

      if (sink === 'count') {
        return {
          lines: [
            {
              text: hits.length === 1 ? '1 post' : `${hits.length} posts`,
              tone: hits.length === 0 ? 'faint' : 'dim',
            },
          ],
        }
      }

      if (sink === 'go') {
        const first = hits[0]
        if (!first) return { lines: [{ text: 'nothing matched, so there’s nowhere to go.', tone: 'faint' }] }
        const post = await env.getPost(first.room, first.id)
        if (!post) return error(`post ${first.id} isn’t there anymore.`)
        return { lines: renderPost(post), location: { room: first.room, postId: first.id } }
      }

      return error(`i can’t pipe into ${sink}. try: | count, or | go`)
    },
  },
]

const FLAG_NAMES = ['room', 'rooms', 'by', 'since', 'limit']

function buildQuery(
  input: string,
  location: Location,
): { query: PostQuery } | { problem: string } {
  const { values, loose } = parseFlags(input)

  for (const name of values.keys()) {
    if (FLAG_NAMES.includes(name)) continue
    // The doc's own example reaches for --tag. Rooms already do that job, and
    // saying so is more use than listing the flags that do exist.
    if (name === 'tag') {
      return { problem: 'there are no tags — rooms do that job. try: find --room=poker' }
    }
    return { problem: `i don’t know --${name}. try: ${FLAG_NAMES.map((f) => `--${f}`).join(', ')}` }
  }

  // Bare words are the search itself. Refusing them, as this used to, turned
  // away the most obvious way anyone would reach for this.
  const query: PostQuery = { limit: 20 }
  if (loose.length > 0) query.text = loose.join(' ')

  const room = values.get('room')
  if (room !== undefined) {
    if (room === '') return { problem: 'which room? try: find --room=music' }
    query.room = room.toLowerCase()
  } else if (location.room !== undefined) {
    // Standing somewhere is itself a filter; naming the room again would be
    // busywork. --room from anywhere still overrides it.
    query.room = location.room
  }

  const by = values.get('by')
  if (by !== undefined) {
    if (by === '') return { problem: 'said by whom? try: find --by=marisol' }
    query.by = by.toLowerCase()
  } else if (location.person !== undefined) {
    // Standing on somebody is a filter for the same reason standing in a room
    // is: `find tomatoes` on ~marisol means the ones she said. --by overrides.
    query.by = location.person
  }

  const since = values.get('since')
  if (since !== undefined) {
    const from = parseSince(since)
    if (!from) return { problem: `${since} isn’t a length of time. try: --since=7d, 24h, or 30m` }
    query.since = from
  }

  const limit = values.get('limit')
  if (limit !== undefined) {
    const parsed = Number(limit)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      return { problem: 'how many? a whole number from 1 to 100.' }
    }
    query.limit = parsed
  }

  return { query }
}

function renderHits(hits: readonly PostHit[], term?: string): Line[] {
  if (hits.length === 0) {
    return [{ text: term ? `nothing said about ${term}.` : 'nothing matched.', tone: 'faint' }]
  }

  const lines: Line[] = []
  for (const hit of hits) {
    // The address comes first and includes the room, because a search crosses
    // rooms and the result has to remain somewhere you can go.
    // "(reply)" rather than a different address: a reply has no address of its
    // own (§4.3), so the one shown is the post it is under — which is exactly
    // what you type to go and read it, and would be a lie without the marker.
    lines.push({
      text: `${hit.room}/${hit.id}  ${hit.author}, ${formatAgo(hit.createdAt)}${hit.isReply ? '  (reply)' : ''}`,
      tone: 'dim',
    })
    lines.push({ text: hit.body, depth: 1 })
  }
  return lines
}

/** Rooms as results. Says which are quiet, because that decides whether to go. */
function renderRoomHits(hits: readonly RoomHit[], term: string): Line[] {
  if (hits.length === 0) {
    return [
      {
        text: term ? `no room called ${term}, and none about it.` : 'no rooms.',
        tone: 'faint',
      },
    ]
  }

  const lines: Line[] = []
  for (const hit of hits) {
    lines.push({ text: hit.slug, tone: 'accent' })
    lines.push({ text: hit.gloss, tone: 'dim', depth: 1 })
    lines.push({
      // A room with nothing in it and a room nobody has been in for a month are
      // different invitations, and the count is what tells them apart.
      text:
        hit.posts === 0
          ? 'nothing in it yet'
          : `${hit.posts} ${hit.posts === 1 ? 'post' : 'posts'}${
              hit.latestAt ? `, newest ${formatAgo(hit.latestAt)}` : ''
            }${hit.inLobby ? '' : ' — quiet, so it’s not in the lobby'}`,
      tone: 'faint',
      depth: 1,
    })
  }
  lines.push({ text: '' })
  lines.push({ text: `go ${hits[0].slug} to walk in.`, tone: 'faint' })
  return lines
}

/**
 * §3.6 — the palette set changes by context, so it never exceeds ~6 items
 * regardless of how many commands exist. `what` and `help` sit at the lobby,
 * where a newcomer is standing; the doing verbs take the slots elsewhere.
 */
/**
 * §3.6 — the glossary, per place you can stand.
 *
 * Two rules decide the order, and both are about the 380px viewport this is a
 * horizontal scroller on.
 *
 * `say` leads wherever it is valid. Third place put the primary action — the
 * one §3.9's whole design hangs on — off the right edge with nothing to say it
 * was there.
 *
 * `help` is in every set and never last. It was only ever in the lobby, and
 * even there it sat fifth, off-screen: the one chip whose entire audience is
 * somebody who does not know what to do was the one they had to already know
 * to scroll for. Second place is measured, not guessed — `e2e/mobile-shell`
 * asserts it is inside the viewport without scrolling, in every context.
 */
export const CHIP_SETS: Record<Context, readonly string[]> = {
  lobby: ['look', 'help', 'go', 'who', 'theme'],
  room: ['say', 'help', 'look', 'go', 'who', 'leave'],
  commons: ['say', 'help', 'look', 'who', 'leave'],
  post: ['say', 'help', 'look', 'who', 'leave'],
  // Somebody else's page. No `say`: only they can start things on their wall,
  // and a palette that offers a verb which always fails teaches the wrong thing.
  // `go` leads because every line on the page is an address you can open.
  person: ['go', 'help', 'look', 'find', 'leave'],
}

/**
 * Your own page, which is the only place `say` means "put it on your wall".
 *
 * A separate set rather than a sixth Context: standing on your own profile is
 * the same *place* as standing on somebody else's — same prompt, same URL
 * shape, same valid commands — and the only difference is whether the write
 * will be allowed. Context decides what is possible; this decides what to
 * offer. `say` still leads, for the same reason it does in a room.
 */
export const OWN_WALL_CHIPS: readonly string[] = ['say', 'help', 'look', 'go', 'find', 'leave']

const BY_NAME = new Map<string, Command>()
for (const command of COMMANDS) {
  BY_NAME.set(command.verb, command)
  for (const alias of command.aliases) BY_NAME.set(alias, command)
}

/** Canonical verbs and every alias, resolved the same way (§3.5). */
export function findCommand(word: string): Command | undefined {
  return BY_NAME.get(word.toLowerCase())
}

export function allWords(): string[] {
  return [...BY_NAME.keys()]
}

/** Everything a "did you mean" may propose — hidden commands excluded (§4.8). */
function suggestableWords(): string[] {
  return [...BY_NAME.entries()].filter(([, c]) => !c.hidden).map(([word]) => word)
}

/** §3.7 — unknown input guesses the nearest verb, and shows its description. */
export function nearestCommand(word: string): Command | undefined {
  const near = nearestSlug(word, suggestableWords())
  return near ? BY_NAME.get(near) : undefined
}

export function nearestSlug(word: string, candidates: readonly string[]): string | undefined {
  const target = word.toLowerCase()
  // Short words tolerate one typo, longer ones two. Beyond that a "did you
  // mean" is a guess, and a wrong guess teaches nothing.
  const limit = target.length <= 3 ? 1 : 2

  let best: string | undefined
  let bestDistance = Infinity
  for (const candidate of candidates) {
    const distance = editDistance(target, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best !== undefined && bestDistance <= limit && bestDistance < best.length ? best : undefined
}

/**
 * Damerau-Levenshtein (optimal string alignment), not plain Levenshtein.
 *
 * Swapped adjacent letters are the most common way a person mistypes a short
 * word, and plain Levenshtein scores `sya` → `say` as two edits, which puts
 * every three-letter verb out of reach of a suggestion. Counting a
 * transposition as one edit is what makes `sya` reach `say` without having to
 * loosen the threshold and start guessing wrongly.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0

  let twoBack: number[] = []
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution)

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        current[j] = Math.min(current[j], twoBack[j - 2] + 1)
      }
    }
    twoBack = previous
    previous = current
  }
  return previous[b.length]
}
