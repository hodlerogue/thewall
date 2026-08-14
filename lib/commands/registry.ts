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
import { ROOM_PAGE, type Env } from '@/lib/shell/env'
import { formatAgo, type PostHit, type PostQuery, type RoomHit } from '@/lib/shell/model'
import {
  renderFeed,
  renderPost,
  renderPosts,
  renderProfile,
  renderRoom,
  renderRoomList,
  saidBy,
} from '@/lib/shell/render'
import type { RoomList } from '@/lib/shell/model'
import type { Session } from '@/lib/shell/session'
import { ABOUT_SUMMARY } from '@/lib/guide/about'
import { PRIVACY, TERMS } from '@/lib/legal/documents'
import { offerInstall } from '@/lib/pwa/install'
import { hintsOn, setHints } from '@/lib/shell/hints'
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
  /**
   * Named on another verb's line in `help` rather than taking one of its own.
   *
   * Not `hidden`, which also removes a verb from the palette and the
   * "did you mean" pool — this is only about the glossary's length. §3.6 caps
   * the first group at ten lines because eleven is a wall again, so adding a
   * row means choosing one to drop, deliberately, rather than letting the list
   * grow past the point it can be read at a glance.
   *
   * The first attempt folded `write` into `say`'s gloss instead — and the
   * mobile gate caught it, because a chip's label *is* its gloss and
   * "post something here, or write for a longer one" pushed the primary action
   * off the right edge of a 380px strip. §8 makes that the kill condition.
   *
   * The verb still has its own `what` entry, its own chip, and its own place in
   * the alias table. Only the glossary row is folded.
   */
  folded?: boolean
  /**
   * The argument is content, not an instruction.
   *
   * True for exactly two verbs, and it changes one thing: the echo of what was
   * typed keeps the words at full brightness and dims only the prompt and the
   * verb in front of them. Everywhere else the whole echo recedes, which is
   * right — when you type `go music`, the answer is the point.
   *
   * `say` and `reply` are the two where what you typed *is* the point, and
   * dimming it uniformly meant somebody's own sentence rendered at 9.1:1 while
   * the same words read back in the room a moment later were 14.0:1. The site
   * was using its own hierarchy to rank your contribution below the reading
   * of it.
   */
  contributes?: boolean
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

/**
 * The lobby, from what the Env handed back.
 *
 * A helper because `listRooms` returns a page *and* a total now, and a caller
 * that passes only the page silently under-reports how many rooms there are —
 * "28 more" where the truth is "298 more". A wrong number reads as a fact, so
 * there is one place that knows how to unpack this.
 */
const renderLobby = (lobby: RoomList): Line[] =>
  renderRoomList(lobby.rooms, undefined, undefined, lobby.total)

/** The one room that holds nothing of its own — see the feed migration. */
const FEED = 'feed'

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

/**
 * What `reply` reads in front of the words: `5`, or `music/12`, or `~marisol/2`.
 *
 * Six digits, because `post_no` is allocated per room and a room with a million
 * posts in it is not a thing this site will see — and because an unbounded run
 * of digits at the front of a sentence is more likely to be somebody's phone
 * number than an address.
 *
 * The slash form deliberately excludes a second slash. There are exactly two
 * segments in every address on this site (§3.4), and matching loosely here
 * would swallow a URL somebody pasted at the start of a reply.
 */
const NUMBER = /^\d{1,6}$/
const ADDRESS = /^[^/\s]+\/\d{1,6}$/

/**
 * Why there is nothing to answer at an address, or null if there is.
 *
 * Checked before anything is written, because the alternative is worse than an
 * error: `reply music/12 <something>` typed at a post that is not there would
 * either fail at the database with whatever it says, or — for somebody with no
 * account — ask two signup questions first and *then* fail, having spent the
 * sentence §3.9 exists to protect.
 */
async function nothingAt(env: Env, room: string, id: number): Promise<string | null> {
  const post = await env.getPost(room, id).catch(() => undefined)
  if (post) return null

  const found = await env.getRoom(room).catch(() => undefined)
  // A wall is a room, and "there's no room called ~tuck" is the one place that
  // equivalence leaks — nobody thinks of somebody's page as a room they might
  // have misspelled.
  if (!found) {
    return room.startsWith('~')
      ? `there’s nothing on ${room.slice(1)}’s wall yet.`
      : `there’s no room called ${room}. try: look`
  }
  // `getPost` returns nothing for an ephemeral room whether or not the post is
  // there, so this says which of the two happened rather than guessing.
  if (found.ephemeral) {
    return `${room} keeps nothing for longer than a day, so there’s nothing there to answer.`
  }
  const newest = found.posts[0]?.id
  return newest === undefined
    ? `there’s nothing in ${room} yet, so there’s nothing at ${room}/${id}.`
    : `there’s nothing at ${room}/${id}. the newest one is ${room}/${newest}.`
}

/**
 * The one write path a reply takes, wherever it was aimed from.
 *
 * `elsewhere` is the only thing that changes: when the reply is going somewhere
 * you are not standing, the prompt does not say where it went, so the
 * confirmation has to. See `Session.write`.
 */
async function sendReply(
  args: HandlerArgs,
  target: Location,
  body: string,
  toReply?: number,
): Promise<RunResult> {
  const { session, location } = args
  const elsewhere = target.room !== location.room || target.postId !== location.postId

  if (session.name() === null) {
    /*
     * §3.9 — the sentence is captured first, then the account is asked for.
     * Where it was aimed goes with it: without that, two questions later,
     * answering a particular post quietly becomes answering whatever you
     * happened to be standing in.
     */
    return {
      lines: session.begin({ location: target, body, addressed: true, toReply, elsewhere }),
    }
  }

  const written = await session.write(target, body, { toReply, elsewhere })
  return {
    lines: written.lines,
    retry: written.failed ? args.arg : undefined,
    answered: written.answered,
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
    async run({ context, location, env, session }) {
      // A fresh listing is the newest page, so `older` starts from the top
      // again. Without this, `look` to get your bearings would leave `older`
      // continuing from wherever you had already walked back to.
      session.resetPaging()
      if (context === 'lobby') return { lines: renderLobby(await env.listRooms()) }

      if (context === 'person') {
        const profile = await env.getProfile(location.person!)
        if (!profile) return error(`there’s no one called ${location.person}. try: leave`)
        return { lines: renderProfile(profile) }
      }

      if (location.room === FEED) return { lines: renderFeed(await env.readFeed()) }

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
    async run({ arg, context, location, env, hint, session }) {
      // Walking anywhere lands you on the newest page of wherever you land.
      session.resetPaging()
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
        if (location.room === FEED) {
          /*
           * Numbers are allocated per room, so `2` on the feed is two or three
           * different posts at once. The whole address is shown against every
           * line here for exactly that reason, and `go` already takes one.
           */
          const feed = await env.readFeed().catch(() => [])
          const example = feed[0] ? `${feed[0].room}/${feed[0].id}` : '~marisol/2'
          return error(
            `these live on people's walls, so the number needs the name — try: go ${example}`,
          )
        }
        const post = await env.getPost(location.room!, id)
        if (!post) return error(`there’s no post ${id} in ${location.room}. try: look`)
        return { lines: renderPost(post), location: { room: location.room, postId: id } }
      }

      if (arg.toLowerCase() === FEED) {
        return { lines: renderFeed(await env.readFeed()), location: { room: FEED } }
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

        const { rooms } = await env.listRooms()
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
    /*
     * "create doesn't appear to be showing in the help menu."
     *
     * It was showing — as `make — start a new room`, which is the right verb by
     * §3.5 and the wrong word to go looking for. `create` is an alias, so it
     * works when typed and is listed under `what make`, and neither of those
     * helps somebody scanning a list for the word they already have in mind.
     *
     * Swapping the verb was the other option and is worse: `make` is shorter,
     * it is what the palette and every error message already say, and moving it
     * renames a verb people have learned. Putting the word in the gloss costs
     * one word and makes the line findable by either name.
     */
    gloss: () => 'create a new room',
    detail: () =>
      'makes a room: make garden what you are growing (create works too). the first word is its name, the rest says what it is for and shows under it in the lobby. you need a verified account, and you can make three a week. a room has no owner — once it exists it is everybody\u2019s. made from inside another room, it asks first whether that room should list it at the bottom as having grown out of it — say n and it is made without the line, because there is no undoing one. either way it is an ordinary room with an ordinary name, in the lobby and reachable by name, not something inside anything.',
    insert: () => 'make ',
    wrongContext: () => '',
    async run({ arg, context, location, env, session }) {
      const [slug = '', ...rest] = arg.trim().split(/\s+/)
      const gloss = rest.join(' ')

      /*
       * Where you were standing, so a room made from inside one is recorded as
       * having grown out of it — and shows up in a line at the bottom of that
       * room. Subtopics without nesting; see the migration for why not nesting.
       *
       * From a post, the room the post is in: `make` from inside `music/12` is
       * still `make` from music, and reading a thread is the commonest moment
       * to want a room for the tangent.
       *
       * Never the feed (it holds nothing and is nobody's parent) and never a
       * wall — "jazz grew out of ~marisol" is not a thing anybody means. The
       * lobby has no room to be from. `create_room` checks all of this again
       * rather than trusting it.
       */
      const from =
        context === 'lobby' ||
        context === 'person' ||
        location.room === undefined ||
        location.room === FEED ||
        location.room.startsWith('~')
          ? undefined
          : location.room

      if (slug === '') {
        return error('make what? try: make garden')
      }
      if (session.name() === null) {
        return error('you need a name first. say something anywhere and i’ll ask you for one.')
      }

      /**
       * `attach` decides whether the room somebody is standing in is recorded
       * as this one's parent. Always false from the lobby, and answered out
       * loud everywhere else — see `askFirst`.
       */
      const open = async (line: string, attach: boolean): Promise<RunResult> => {
        const made = await env.makeRoom(slug, line, attach ? from : undefined)
        if (!made.ok) return error(made.reason)

        const room = await env.getRoom(made.slug)

        // Said after the fact as well as before it, because the question is
        // answered in one keypress and a keypress is easy to make by accident
        // too. This is the line that tells you which of the two you got.
        const grew = room?.fromRoom
        return {
          lines: [
            { text: `${made.slug} is open. you are in it.`, tone: 'accent' },
            ...(grew
              ? [
                  {
                    text: `it grew out of ${grew}, which lists it at the bottom now.`,
                    tone: 'faint' as const,
                  },
                ]
              : []),
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
      /**
       * Ask before attaching, because attaching cannot be taken back.
       *
       * The report: "imagine being in kitchen and making a room for a board
       * game and now you go into kitchen and that's one of the rooms you see.
       * and there's no way to move or undo it." Both halves are true.
       * `from_room` is written once by `create_room` and there is no update
       * path to it — no grant, no function, no command — so a room made while
       * you had forgotten where you were standing leaves a line at the bottom
       * of somebody else's room for good.
       *
       * That is the whole argument for a question. Everywhere else `make` is
       * deliberately frictionless, and it stays that way: from the lobby there
       * is no parent, so there is nothing to ask and nothing is asked.
       *
       * **`n` makes the room anyway, without the line.** Cancelling would be
       * the obvious thing and the wrong one: the room is wanted — it is the
       * attachment that was an accident — and a confirm that throws the work
       * away teaches people to hit `y` to get past it, which is the opposite
       * of what it is for.
       *
       * Anything that is not yes or no asks again rather than guessing. Both
       * answers are permanent, so there is no safe default to fall back on.
       */
      const askFirst = (line: string, again = false): Line[] =>
        session.askOne(
          [
            ...(again ? [{ text: 'y or n.', tone: 'faint' as const }] : []),
            { text: `you are in ${from}. make ${slug} here?`, tone: 'accent' as const },
            {
              text: `${from} will list ${slug} at the bottom, and nothing can take it off again.`,
              tone: 'faint' as const,
            },
            {
              text: `y for that. n to make ${slug} on its own, with no line in ${from}.`,
              tone: 'faint' as const,
            },
          ],
          async (answer) => {
            const said = answer.trim().toLowerCase()
            if (said === 'y' || said === 'yes') return open(line, true)
            if (said === 'n' || said === 'no') return open(line, false)
            return { lines: askFirst(line, true) }
          },
        )

      /** From the lobby there is no parent, so there is nothing to ask. */
      const begin = async (line: string): Promise<RunResult> =>
        from === undefined ? open(line, false) : { lines: askFirst(line) }

      if (gloss === '') {
        return {
          lines: session.askOne(
            [
              { text: `what is ${slug} for?`, tone: 'accent' },
              { text: 'a few words. it goes under the name in the lobby, and it is how people know what to put there.', tone: 'faint' },
            ],
            async (answer) => {
              const result = await begin(answer)
              return { lines: result.lines, location: result.location }
            },
          ),
        }
      }

      return begin(gloss)
    },
  },

  {
    verb: 'say',
    contributes: true,
    /*
     * `write` used to be here and is a verb of its own now — the longer form,
     * with paragraphs. Leaving it as an alias would make one word mean two
     * things, and the alias test caught it the moment the new verb landed,
     * which is the second time that test has earned itself.
     */
    aliases: ['wall', 'post', 'talk'],
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

      /*
       * Standing on the feed, `say` puts it on your own wall.
       *
       * The feed is a view of walls and holds nothing itself — the database
       * refuses a post addressed to it. Refusing here too would be correct and
       * useless: somebody reading everybody's walls and typing a sentence means
       * to add one, and the only wall they can add to is theirs.
       */
      if (location.room === FEED) {
        const me = session.name()
        if (me === null) {
          // The wall is named at commit time, once there is a name to name it
          // with — see `Held.toOwnWall`.
          return { lines: session.begin({ location, body: arg, toOwnWall: true }) }
        }
        const onWall = await session.write({ room: `~${me}` }, arg)
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
      return {
        lines: written.lines,
        retry: written.failed ? arg : undefined,
        answered: written.answered,
      }
    },
  },

  {
    /*
     * A post with paragraphs in it.
     *
     * The gap this fills is smaller than it looks and was never about length:
     * the cap was already two thousand characters. The prompt is a single-line
     * `<input>`, so there was no way to type a line break — a long post had to
     * be one unbroken block, and pasting one in flattens it.
     *
     * Deliberately *not* a second kind of post. What comes out is an ordinary
     * post at an ordinary address; nothing else in the system learns a new
     * concept, no listing has to ask which kind a thing is, and the site never
     * says "these are the real posts and those are the lesser ones". The idea
     * that started this had a 280-character floor to qualify — dropped, because
     * all twenty-one posts the site ships as its own example of good content
     * are under it, the longest by half.
     */
    verb: 'write',
    aliases: ['compose', 'longer', 'essay'],
    // Wherever `say` starts something. Not commons — §3.10 keeps nothing there,
    // and a page of writing is the worst thing to lose to a 24-hour expiry.
    contexts: ['room', 'post', 'person'],
    gloss: (c) => (c === 'post' ? 'a longer answer' : 'a longer post, with paragraphs'),
    detail: () =>
      'takes more than one line. type write, then the post — a line with just a dot on it ends it and sends it. blank lines are paragraph breaks, cancel throws it away, and the limit is 4000 characters. what comes out is an ordinary post at an ordinary address; say is the same thing for one line.',
    insert: () => 'write',
    wrongContext: () =>
      'commons keeps nothing for longer than a day, so it is the wrong place for something you spent time on. try a room.',
    async run({ arg, context, location, session }) {
      if (arg !== '') {
        // §3.7 — name the fix. Somebody typing `write about the thing` means to
        // start, not to post those four words, and posting them would be a
        // surprise nobody could undo.
        return error('write takes no words on this line. type write on its own, then the post.')
      }

      if (context === 'person' && location.person !== session.name()) {
        return error(`this is ${location.person}'s wall — only they can put things on it.`)
      }

      const target = context === 'person' ? { room: `~${location.person}` } : location
      return { lines: session.compose(target, true) }
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
    contributes: true,
    aliases: ['re', 'answer'],
    /*
     * Everywhere, including commons — which it did not used to be.
     *
     * The rule was "a verb that is listed and always fails is the same defect
     * as a palette chip that always fails", and commons was the one place
     * `reply` could never work: §3.10 gives it no threads and a trigger in the
     * schema refuses replies there. That is still true of replying *in* commons
     * and no longer true of the verb, because `reply music/12 <something>` names
     * where it is going and works from wherever you are standing. Leaving
     * commons out would have made the site answer that with "commons doesn't
     * keep replies", which is a true sentence about a different question.
     */
    contexts: ALL,
    // No dash inside a gloss: help renders `verb — gloss`, and a second one
    // turns the line into a puzzle.
    /*
     * The gloss teaches the form that works from where you are standing, which
     * is the whole job of this line — `help` is a list of what you can type
     * *here*. "answer a post" was true everywhere and useful nowhere: in the
     * lobby and in commons the bare form always fails and the address form
     * always works, and saying so is the difference between a line somebody
     * reads and a line somebody can follow.
     */
    gloss: (c) =>
      c === 'post'
        ? 'answer this'
        : c === 'room' || c === 'person'
          ? 'answer a post by its number'
          : 'answer a post by its address',
    detail: () =>
      'answers somebody. inside a post, reply <something> answers the post and reply 2 <something> answers reply 2, saying so on the line. from outside, name the post: in a room reply 5 <something> answers post 5 without opening it, and reply music/12 <something> works from anywhere — the same address find and mail print. tapping any of those numbers on the screen types it for you rather than sending anything. commons is the one place nothing can be answered, because nothing there is kept.',
    insert: (c) => (c === 'post' || c === 'room' ? 'reply ' : 'go '),
    // Never used: `contexts` is ALL, so nothing is ever the wrong place. Kept
    // because the interface requires it and an empty string is the honest
    // answer rather than a sentence nobody will read.
    wrongContext: () => '',
    async run(args) {
      const { context, location, env } = args

      /*
       * The first word, when there is a word after it, is where this is aimed.
       *
       * One grammar, borrowed whole from `go`, because `go` had already
       * answered this question: a bare number is the numbered thing where you
       * are standing, and `room/number` is a whole address that works from
       * anywhere. Asked for as `reply/5`, which is the one spelling it cannot
       * have — `music/12` already means "post 12 in music", so `reply/5` reads
       * as post 5 in a room called reply. A space is the whole difference.
       */
      const split = /^(\S+)\s+([\s\S]+)$/.exec(args.arg.trim())
      const aim = split ? split[1] : args.arg.trim()
      const body = split ? split[2].trim() : ''

      /*
       * Inside a post a bare number is a reply in this thread, and that is read
       * first because it is the older meaning and the commoner one — the
       * numbers are on the screen in front of you as you type.
       *
       * The number is only ever read by `reply`, never by `say`. `say 2 hello`
       * has to keep posting the words "2 hello": `say` is content and nothing
       * else, and a verb that sometimes eats its first word is a verb nobody
       * can predict. That asymmetry is the point — `reply` is the one that
       * takes an address, because it is the one with something to point at.
       */
      const inThread = context === 'post' && NUMBER.test(aim)
      if (inThread && body !== '') {
        /*
         * The reply has to be there, for the same reason a post does.
         *
         * `reply 0 x` and `reply 99 x` in a two-reply thread both used to send:
         * the database drops a pointer that names nothing rather than refusing,
         * so the answer landed correctly — and the confirmation printed `→ 99`
         * over it, claiming a link that was never stored. A receipt for
         * something that did not happen is worse than an error.
         */
        const toReply = Number(aim)
        // Undefined means the read failed, not that the thread is empty — and
        // refusing somebody's answer because the network hiccupped would be a
        // far worse trade than a pointer nobody checked.
        const post = await env.getPost(location.room!, location.postId!).catch(() => undefined)
        if (post && !post.replies.some((reply) => reply.id === toReply)) {
          const last = post.replies[post.replies.length - 1]?.id
          return error(
            last === undefined
              ? `nothing to answer here yet — reply ${body} answers the post itself.`
              : `there’s no reply ${toReply} here. they run 1 to ${last}.`,
          )
        }
        return sendReply(args, location, body, toReply)
      }

      /*
       * A number, or a whole address, naming a post you are not standing in.
       *
       * The address form is what `find`, `mail` and a profile all print, which
       * is most of why this is worth having: the thing to type back is already
       * on the screen. The bare number is the same convenience one step closer
       * — in a room you can see the numbers in the listing, and answering one
       * should not cost a round trip through `go`.
       */
      const numbered = context === 'room' || context === 'person'
      const aimed = ADDRESS.test(aim) || (NUMBER.test(aim) && numbered)
      if (aimed && body === '') {
        // Not an error about the number. Somebody has typed the address and
        // stopped, and the missing half is the sentence.
        return error(`reply ${aim} <something> — what you want to say goes on the same line.`)
      }

      if (aimed) {
        const target = ADDRESS.test(aim)
          ? pathToLocation(`/${aim}`)
          : // A wall is a room, so a number on somebody's page is a post on it
            // — the same branch `go` takes, for the same reason.
            { room: context === 'person' ? `~${location.person}` : location.room, postId: Number(aim) }

        if (target.room === undefined || target.postId === undefined) {
          return error(
            `a number on its own needs a room here — try: reply ${await args.hint()}/12 <something>`,
          )
        }
        if (target.room === FEED) {
          /*
           * Numbers are allocated per wall, so `5` on the feed is five or six
           * different posts at once. Every line there already carries its whole
           * address for exactly that reason, so the fix is to use one.
           */
          const feed = await env.readFeed().catch(() => [])
          const example = feed[0] ? `${feed[0].room}/${feed[0].id}` : '~marisol/2'
          return error(
            `these live on people’s walls, so the number needs the name — try: reply ${example} ${body}`,
          )
        }

        const missing = await nothingAt(env, target.room, target.postId)
        return missing ? error(missing) : sendReply(args, target, body)
      }

      if (context === 'post') {
        // Otherwise this *is* say — looked up rather than duplicated, so there
        // is exactly one contribution path and §3.9's held-sentence machinery
        // cannot be bypassed by a second door onto it.
        return findCommand('say')!.run(args)
      }

      /*
       * Words with no post named. §3.7 — name the fix, and name a real one: a
       * post that is actually there beats an invented number, which is the
       * difference between an instruction somebody can follow and one they have
       * to decode. Their sentence is carried into the suggestion, so following
       * it is one edit rather than retyping.
       */
      const words = args.arg.trim() === '' ? '<something>' : args.arg.trim()

      /*
       * The feed holds nothing of its own — it is a view of walls — so asking
       * it for a post to name back answers "there's nothing in feed to answer
       * yet", which is the empty-room lie this codebase has now fixed on five
       * surfaces. What is true is that its numbers need the wall in front.
       */
      if (location.room === FEED) {
        const feed = await env.readFeed().catch(() => [])
        const example = feed[0] ? `${feed[0].room}/${feed[0].id}` : '~marisol/2'
        return error(`these live on people’s walls, so the number needs the name — try: reply ${example} ${words}`)
      }

      if (context === 'room' || context === 'person') {
        const room = context === 'person' ? `~${location.person}` : location.room!
        const example = (await env.getRoom(room).catch(() => undefined))?.posts[0]?.id
        return error(
          example === undefined
            ? context === 'person'
              ? `there’s nothing on ${location.person}’s wall to answer yet.`
              : `there’s nothing in ${room} to answer yet. say something instead.`
            : `reply to which one? try: reply ${example} ${words}`,
        )
      }
      return error(
        context === 'commons'
          ? `commons keeps nothing, so there’s nothing here to answer — name a post elsewhere, like reply ${await args.hint()}/12 <something>`
          : `reply to which one? name it — try: reply ${await args.hint()}/12 <something>`,
      )
    },
  },

  {
    verb: 'who',
    aliases: ['people', 'online', 'users'],
    contexts: ALL,
    gloss: () => 'who’s around',
    detail: () =>
      'lists who’s around right now. anybody reading without a name is counted rather than named — including you, until you say something.',
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

      /*
       * §3.9 — guest state is ambient, never nagging, but `who` says why.
       *
       * It used to say "you're one of them — say something and you'll be on the
       * list", and both halves pointed at something that is not always there.
       * Reported as: "say something and you'll be on the list? what list?"
       *
       * "The list" meant the comma-separated names two lines up, which is a
       * long way to reach for a referent — and when nobody is signed in, that
       * line reads "nobody signed in right now" and there is no list at all.
       * "One of them" has the same problem against the guest count: presence
       * answers `{ names: [], guests: 0 }` whenever the channel is not open, so
       * it could be one of nobody.
       *
       * This says the thing itself instead. It repeats the words the count line
       * uses, so the connection is the sentence rather than the layout, and it
       * names what actually happens next — you are asked for a name — rather
       * than a membership nothing on screen explains.
       */
      if (session.name() === null) {
        lines.push({
          text: 'you’re reading without a name — say something and you’ll be asked what to call you.',
          hint: true,
          tone: 'faint',
        })
      }
      return { lines }
    },
  },

  {
    verb: 'leave',
    aliases: ['back', 'exit', 'up'],
    /*
     * §3.1 — backs out one level. Not from *anywhere*, which is what this
     * claimed and what put it in `help` at the lobby, described as "back to the
     * lobby" to somebody already standing in it. A list of what you can type
     * that includes something you cannot is worse than a shorter list.
     */
    contexts: ['room', 'commons', 'post', 'person'],
    /*
     * "back to the room" was right for a post in a room and wrong for a post on
     * a wall, which backs out to the person whose wall it is — the same context,
     * two destinations, and `gloss` only sees the context. So it stops promising
     * a destination it cannot always name, and `detail` spells out both.
     */
    gloss: (c) => (c === 'post' ? 'back one step' : 'back to the lobby'),
    detail: () =>
      'backs you out one level. from a post, to the room it is in — or to somebody’s page, if the post is on their wall. from a room or a page, back to the lobby.',
    insert: () => 'leave',
    wrongContext: () => 'you’re already at the lobby.',
    async run({ context, location, env }) {
      if (context === 'lobby') {
        // Unreachable through `run`, which sends a wrong-context verb to the
        // message above. Kept because `leave` is also called directly.
        return { lines: [{ text: 'you’re already at the lobby.', tone: 'faint' }] }
      }
      if (context === 'post') {
        const room = await env.getRoom(location.room!)
        if (!room) return { lines: renderLobby(await env.listRooms()), location: {} }

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
      return { lines: renderLobby(await env.listRooms()), location: {} }
    },
  },

  {
    /*
     * The verb that makes the site's own claim true.
     *
     * /about says "it cannot scroll forever. A room holds what people said in
     * it, and when you have read it you have read it." For any room past a
     * page that was false: you got the newest page, nothing said so, and the
     * only way to anything older was `go 5` for a number you had no way to
     * know. A room quietly became write-only past its first page.
     *
     * Not `more`, which reads as "more of the same kind of thing" and is what
     * a feed's button says. `older` names the direction, which is the whole
     * information — you are walking backwards through time, and the site is
     * finite in that direction.
     */
    verb: 'older',
    /*
     * Folded out of the glossary, and it is the right one to fold.
     *
     * §3.6 caps the first group at ten lines because eleven is a wall again,
     * and `write` earned a row — a genuinely new thing you can do. This is the
     * entry that can spare one: a room that has more than a page prints
     * "older — the page before this one" at the top of its own listing, every
     * time it is looked at, which is exactly where and when it is useful. A
     * permanent row for a paging control is the redundancy.
     *
     * `what older` still explains it, the chip is still there, and the alias
     * table is untouched.
     */
    folded: true,
    // Not `back`: that is `leave`'s, and the signup flow says "type back to
    // change the name" out loud. Two meanings for one word in a shell whose
    // whole promise is that typing a word does the obvious thing.
    aliases: ['earlier', 'previous', 'more'],
    contexts: ['room', 'commons'],
    gloss: () => 'the page before this one',
    detail: () =>
      'walks back through a room a page at a time. a room shows its newest 60; older shows the 60 before those, and again after that, until you reach the start of the room.',
    insert: () => 'older',
    wrongContext: (_c, hint) => `there’s nothing to walk back through here. try: go ${hint}`,
    async run({ context, location, env, session }) {
      const slug = location.room!

      /*
       * The cursor, or a round trip to find one.
       *
       * `older` straight after arriving has nothing stored, because arriving
       * does not tell the session which addresses it printed — six places
       * render a room and keeping all six in step is the kind of bookkeeping
       * that goes wrong quietly. Asking the room for its newest page again is
       * one indexed query, and it happens once per room rather than per step.
       */
      let from = session.pagedFrom(slug)
      if (from === null) {
        const room = await env.getRoom(slug)
        if (!room) return error(`${slug} isn’t there anymore. try: leave`)
        if (room.posts.length === 0) {
          return { lines: [{ text: 'nothing here yet, so there is nothing before it.', tone: 'faint' }] }
        }
        /*
         * The lowest address on the page, not the last element of it.
         *
         * The cursor is an address, so the starting point has to be one too.
         * Taking `posts[length - 1]` assumed the array arrived newest-first,
         * which is true of the query and was not true of every fixture — and
         * where it was not, `older` fetched the *newest* post and printed it
         * back as though it were history.
         */
        from = room.posts.reduce((low, post) => Math.min(low, post.id), Infinity)
      }

      const posts = await env.olderPosts(slug, from)
      if (posts.length === 0) {
        // §3.7 — and it is a real answer rather than a failure: reaching the
        // start of a room is the thing this verb exists to let you do.
        return {
          lines: [
            { text: 'that’s the start of the room — there’s nothing before it.', tone: 'faint' },
          ],
        }
      }

      const oldest = posts.reduce((low, post) => Math.min(low, post.id), Infinity)
      session.paged(slug, oldest)

      // The context is the authority on whether this room keeps anything —
      // it is what §3.10 splits commons out by, and it is already resolved.
      const lines = renderPosts(posts, context === 'commons', undefined, slug)
      lines.push({
        text:
          posts.length < ROOM_PAGE
            ? 'that’s the start of the room.'
            : 'older again for the page before this one.',
        tone: 'faint',
      })
      return { lines }
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
      /*
       * This is a running order, not a set — the second group prints in this
       * sequence rather than in registry order.
       *
       * It used to be membership only, so the group came out in whatever order
       * the commands happened to be declared in, which put the newest entry
       * last every time. `login` is the newest entry and is also the one thing
       * on the list somebody might be stuck without, so inheriting "last"
       * from a file's edit history is the wrong way to decide that.
       *
       * `about` opens it because it answers the question somebody new has, and
       * `what`/`help` close it because they are about the list itself.
       */
      const ELSEWHERE = [
        'about',
        'login',
        'logout',
        'mail',
        'notify',
        'rename',
        'theme',
        'hints',
        'install',
        'terms',
        'privacy',
        'what',
        'help',
      ]

      const here: Line[] = []
      const elsewhere = new Map<string, Line>()

      for (const command of COMMANDS) {
        // §4.8 — the pipe is not on this list. That is the point of it.
        if (command.hidden || command.folded || !command.contexts.includes(context)) continue
        const line: Line = { text: `${command.verb} — ${command.gloss(context)}`, tone: 'dim' }
        if (ELSEWHERE.includes(command.verb)) elsewhere.set(command.verb, line)
        else here.push(line)
      }

      const about = ELSEWHERE.map((verb) => elsewhere.get(verb)).filter((line) => line !== undefined)

      const lines: Line[] = [{ text: 'from here you can type:', tone: 'faint' }, ...here]
      if (about.length > 0) {
        lines.push({ text: '' })
        lines.push({ text: 'and anywhere:', tone: 'faint' })
        lines.push(...about)
      }
      /*
       * Two places, because this list is verbs and they are not.
       *
       * `feed` and `~name` are rooms, so the only thing that ever named them
       * was the lobby listing and the middle of `what go`. Somebody who types
       * `help` — which is what somebody looking for a feature types — got a
       * list of fifteen verbs with no hint that either existed. "I'm not seeing
       * anything in help about profile, or feed" is what that looks like from
       * outside, and it was accurate.
       *
       * Two lines, not a third group of six. The point is to name the two doors
       * that no verb spells, then get out of the way.
       */
      lines.push({ text: '' })
      lines.push({ text: 'and two places:', tone: 'faint' })
      lines.push({ text: `go ${FEED} — everything anybody put on their own wall`, tone: 'dim' })
      lines.push({ text: 'go ~name — somebody: who they are, and their wall', tone: 'dim' })

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
    aliases: ['themes', 'color', 'colors', 'colour', 'colours'],
    contexts: ALL,
    gloss: () => 'change the colors',
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
    /*
     * The little instructions, and a way to stop being given them.
     *
     * "Not sure people want to be constantly given instructions. There should
     * be a setting that allows you to turn that off for sure."
     *
     * §3.6 asks the interface to teach itself, and that argument is about the
     * first ten minutes — the same line on the four hundredth `look` is the
     * site talking over the conversation, in a room whose whole point is the
     * conversation. So the lines stay, on by default, and four characters ends
     * them: somebody who has not learned the site cannot know to ask for help,
     * and somebody who has can type.
     *
     * Per browser, like `theme`, and for the same reason — it is a preference
     * about this screen rather than a fact about you, so it needs no account,
     * no column and no round trip.
     */
    verb: 'hints',
    aliases: ['tips', 'quiet'],
    contexts: ALL,
    gloss: () => 'the little instructions, on or off',
    detail: () =>
      'the site prints a line here and there telling you what you could type next — how to answer a post, how to walk back through a room. hints off stops them and remembers it on this device; hints on brings them back; hints on its own says which you have. errors always speak, and so does anything telling you there is more than you can see.',
    insert: () => 'hints ',
    wrongContext: () => '',
    async run({ arg }) {
      const want = arg.trim().toLowerCase()

      if (want === '') {
        return {
          lines: hintsOn()
            ? [
                { text: 'hints are on.', tone: 'faint' },
                { text: 'hints off stops the little instructions.', tone: 'faint' },
              ]
            : [
                { text: 'hints are off.', tone: 'faint' },
                { text: 'hints on brings them back.', tone: 'faint' },
              ],
        }
      }

      if (/^(off|no|stop|none|hide)$/.test(want)) {
        setHints(false)
        return {
          // Not a hint itself, or turning them off would answer with silence
          // and leave somebody wondering whether the command exists.
          lines: [
            { text: 'hints off. errors still speak, and so does anything you cannot see.', tone: 'faint' },
          ],
        }
      }

      if (/^(on|yes|show|back)$/.test(want)) {
        setHints(true)
        return { lines: [{ text: 'hints on.', tone: 'faint' }] }
      }

      // §3.7 — name the fix, and both of them, because there are only two.
      return error(`hints on or hints off — i don’t know "${arg}".`)
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
      'shows replies to things you said, each with the address to walk to — oldest at the top, so the newest is the one nearest the prompt. reading them clears the count. nothing is pushed and nothing chases you; notify on adds one email a day if you want one.',
    insert: () => 'mail',
    wrongContext: () => '',
    async run({ env, session, location }) {
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
        lines.push({ text: `${items.length} replies, oldest first.`, tone: 'dim' })
        lines.push({ text: '' })
      }

      // No silent caps. Reading is what marks mail read (§4.1 is pull-only), so
      // hitting the limit clears replies that were never shown. It is printed
      // above the list rather than below it because that is now where the
      // boundary is: everything cut off is older than the first line here.
      if (items.length >= MAIL_LIMIT) {
        lines.push({
          text: `these are the newest ${MAIL_LIMIT}. anything older is cleared too — find --by=<name> still has it.`,
          tone: 'faint',
        })
        lines.push({ text: '' })
      }

      // Oldest first, so the newest reply is the last thing written and the
      // scrollback's snap-to-bottom lands on it. See `oldestFirst` in
      // lib/shell/render.ts.
      for (const item of [...items].reverse()) {
        /*
         * The address first, because a notification you cannot walk to is just
         * an alert — and here it is also the thing you tap to answer, which is
         * why this list exists at all.
         *
         * Whole-line accent rather than an accent address on a dim header: mail
         * is a list of things asking for an answer and nothing else, so there
         * is no hierarchy to draw. The shape and the tap still come from the
         * one helper, or this would be the line that quietly stopped matching.
         */
        lines.push(
          saidBy(
            `${item.room}/${item.postId}`,
            `${item.author}, ${formatAgo(item.createdAt)}`,
            { tone: 'accent' },
          ),
        )
        lines.push({ text: item.body, depth: 1 })
      }
      lines.push({ text: '' })

      /*
       * No steps at all, now that there are none to take.
       *
       * This said "go music then go 12", then one step once `go` learned to
       * take a whole address — and answering is the whole reason anybody opens
       * this list, so the address printed against every line is now something
       * you can answer *with* rather than only walk to. Reading it is still
       * offered second, because sometimes you want the thread first.
       */
      /*
       * The shortest form that works from where you are standing.
       *
       * `mail` runs from anywhere, so it printed the whole address every time —
       * and standing in kitchen, being told to type `reply kitchen/6` is being
       * taught the long way round to a door you are already at. Reported that
       * way: "inside of kitchen all i have to do is go 6, so that seems
       * misleading. I know it still works, but not the fastest way."
       *
       * The room is compared rather than the context, because a wall is a room
       * and `~marisol/2` shortens to `2` while standing on it for exactly the
       * same reason.
       */
      const here = items[0].room === location.room
      const newest = here ? `${items[0].postId}` : `${items[0].room}/${items[0].postId}`
      lines.push({
        text: `reply ${newest} <something> answers the newest — go ${newest} reads it first.`,
        tone: 'faint',
        hint: true,
      })

      return { lines, mail: 0 }
    },
  },

  {
    /*
     * §4.1, decided differently — and the difference is consent.
     *
     * The document's lean is "pull-only, no push, no email", in the same
     * section that calls notifications the highest-priority unsolved item
     * because "no notification means no reason to return". Both are right, and
     * what reconciles them is that nobody is emailed who did not ask.
     *
     * Off for everybody. On is a thing you type. One a day at most, and only
     * when something is actually waiting — so an empty day is a day with no
     * email, rather than a daily reminder that nothing happened.
     */
    verb: 'notify',
    aliases: ['notifications', 'email', 'digest'],
    contexts: ALL,
    /*
     * Named for the thing somebody is looking for, which changed with the
     * default. While it was opt-in the interesting half was switching it on, so
     * "email me when replies are waiting" was an offer. It is on now, so the
     * person scanning this list is much more likely to be looking for the way
     * out — and a gloss that reads as an offer hides it from them.
     */
    gloss: () => 'the daily email, and how to stop it',
    detail: () =>
      'one email a day, and only on days somebody answered you — a quiet week is a silent week. it is on from the moment you have an account; notify off stops it, and so does the link at the bottom of any of them. nothing else is ever sent to you, there is no second kind of email to end up on, and your address is still never shown to anybody.',
    insert: () => 'notify ',
    wrongContext: () => '',
    async run({ arg, env, session }) {
      if (session.name() === null) {
        return {
          lines: [
            { text: 'you’re reading as a guest, so there’s nowhere to send anything.', tone: 'faint' },
            { text: 'say something first and i’ll ask who you are.', tone: 'faint' },
          ],
        }
      }

      const word = arg.trim().toLowerCase()

      // No argument is a question, not a toggle. Somebody typing `notify` to
      // find out where they stand should not have changed where they stand.
      if (word === '') {
        const on = await env.notifyState()
        return {
          lines: on
            ? [
                // "Which is where everyone starts" because somebody reading
                // this did not turn it on, and a bare "on" invites them to
                // wonder what they clicked. Telling them it is the default is
                // also the most honest place to mention the default at all.
                { text: 'on, which is where everyone starts — one email a day, only when something is waiting.', tone: 'accent' },
                { text: 'notify off stops it.', tone: 'faint' },
              ]
            : [
                { text: 'off. nothing is emailed to you but a sign-in key when you ask for one.', tone: 'faint' },
                { text: 'notify on starts it again — one a day, only on days somebody answered you.', tone: 'faint' },
              ],
        }
      }

      if (!/^(on|off|yes|no|stop)$/.test(word)) {
        return error(`notify on, or notify off. not "${arg}".`)
      }

      const on = word === 'on' || word === 'yes'
      const result = await env.setNotify(on)
      if (!result.ok) return error(result.reason)

      return {
        lines: on
          ? [
              { text: 'on. one email a day, and only when somebody has answered you.', tone: 'accent' },
              { text: 'every one of them has a link that turns this off, and notify off does too.', tone: 'faint' },
            ]
          : [{ text: 'off. nothing more will be sent.', tone: 'accent' }],
      }
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
    /*
     * The way back in.
     *
     * Not hidden, which is the opposite call from `resend` two entries down,
     * and for the opposite reason. `resend` is reachable because the message
     * that needs it names it. Nothing names this one: somebody arriving on a
     * new phone has no session, so no message has fired, and the screen they
     * are looking at is the same one a stranger sees. If it is not in `help` it
     * does not exist for them — and what they do instead is make a second
     * account, which is the failure this whole entry is here to stop.
     */
    verb: 'login',
    aliases: ['signin', 'auth'],
    contexts: ALL,
    gloss: () => 'get back into your account',
    detail: () =>
      'sends a key to the address a name signed up with. login ryan, then type the short code from the email and this browser is ryan again. there are no passwords — the key is the whole of it. the email also has a link, which is one click on a computer; on a phone use the code, because a link tapped in a mail app opens in that app\u2019s own browser and signs you in there instead of here. use this on a new phone, or after clearing your browser.',
    insert: () => 'login ',
    wrongContext: () => '',
    async run({ arg, session }) {
      if (arg === '') {
        const name = session.name()
        // Signed in and typing `login` bare is far more likely to be "am I?"
        // than the start of a switch, so it answers that rather than asking a
        // question they did not have.
        if (name !== null) {
          return {
            lines: [
              { text: `you’re signed in as ${name}.`, tone: 'faint' },
              { text: 'login <name> sends a key for a different account.', tone: 'faint' },
            ],
          }
        }
        return {
          lines: session.askOne(
            [
              { text: 'what name do you go by here?' },
              { text: 'i’ll send a key to the address it signed up with.', tone: 'faint' },
            ],
            async (text) => ({ lines: await session.signIn(text) }),
          ),
        }
      }
      return { lines: await session.signIn(arg) }
    },
  },

  {
    /*
     * Leaving a device.
     *
     * There was no way to do this at all, on a site whose session cookie lasts
     * four hundred days. Signing in on a borrowed phone was therefore a
     * four-hundred-day decision, taken by somebody who thought they were
     * reading a website, with no way to undo it from inside.
     *
     * Not hidden, for the same reason `login` is not: the person who needs it
     * is standing at somebody else's machine wanting to leave, and a verb they
     * have to already know is a verb that is not there.
     */
    verb: 'logout',
    aliases: ['signout', 'bye'],
    contexts: ALL,
    gloss: () => 'leave this device',
    detail: () =>
      'signs this browser out. everything you have said stays exactly where it is — login <yourname> comes back to it. only this device: anything else you are signed in on is untouched.',
    insert: () => 'logout',
    wrongContext: () => '',
    async run({ session }) {
      const { lines, identity } = await session.signOut()
      // `identity` rather than nothing: the prompt says who you are, and it has
      // to stop saying it in the same breath. Returning `null` is what makes it
      // read `guest` again.
      return { lines, identity }
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
  // Oldest first, like everything else printed into the scrollback: the view
  // snaps to the bottom, so the last line written is the one you actually see.
  // See `oldestFirst` in lib/shell/render.ts for the whole argument.
  for (const hit of [...hits].reverse()) {
    // The address comes first and includes the room, because a search crosses
    // rooms and the result has to remain somewhere you can go.
    // "(reply)" rather than a different address: a reply has no address of its
    // own (§4.3), so the one shown is the post it is under — which is exactly
    // what you type to go and read it, and would be a lie without the marker.
    lines.push(
      saidBy(
        `${hit.room}/${hit.id}`,
        `${hit.author}, ${formatAgo(hit.createdAt)}${hit.isReply ? '  (reply)' : ''}`,
      ),
    )
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
        // feed counts zero because it holds nothing — the posts it shows are on
        // walls. Reporting that as "nothing in it yet" is the empty-room lie in
        // a third place.
        hit.slug === FEED
          ? 'everything anybody has put on their own wall'
          : hit.posts === 0
          ? 'nothing in it yet'
          : `${hit.posts} ${hit.posts === 1 ? 'post' : 'posts'}${
              hit.latestAt ? `, newest ${formatAgo(hit.latestAt)}` : ''
            }${hit.inLobby ? '' : ' — quiet, so it’s not in the lobby'}`,
      tone: 'faint',
      depth: 1,
    })
  }
  lines.push({ text: '' })
  lines.push({ text: `go ${hits[0].slug} to walk in.`, tone: 'faint', hint: true })
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
