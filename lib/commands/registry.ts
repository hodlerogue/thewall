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

import type { Env } from '@/lib/shell/env'
import { renderPost, renderRoom, renderRoomList } from '@/lib/shell/render'
import type { Session } from '@/lib/shell/session'
import type { Context, Line, Location, RunResult } from '@/lib/shell/types'

export interface HandlerArgs {
  arg: string
  location: Location
  context: Context
  env: Env
  /** A real room slug, for errors that name the fix. */
  hint: string
  /** Who you are, and the machinery that asks if you aren't anyone yet (§3.9). */
  session: Session
}

export type Handler = (args: HandlerArgs) => Promise<RunResult>

export interface Command {
  verb: string
  aliases: readonly string[]
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

const ALL: readonly Context[] = ['lobby', 'room', 'commons', 'post']

const error = (text: string): RunResult => ({ lines: [{ text, tone: 'error' }] })

export const COMMANDS: readonly Command[] = [
  {
    verb: 'look',
    aliases: ['ls', 'see', 'list', 'show', 'rooms'],
    contexts: ALL,
    gloss: (c) =>
      c === 'lobby' ? 'see what’s around you' : c === 'post' ? 'read it again' : 'see what’s here',
    detail: () =>
      'shows you what’s around you. at the lobby that’s the rooms, inside a room it’s the posts, inside a post it’s the replies.',
    insert: () => 'look',
    wrongContext: () => '',
    async run({ context, location, env, hint }) {
      if (context === 'lobby') return { lines: renderRoomList(await env.listRooms()) }

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
    gloss: (c) => (c === 'lobby' ? 'enter a room' : 'open a post'),
    detail: () =>
      'moves you. at the lobby, go music. inside a room, go 12 opens that post. a room name works from anywhere.',
    insert: () => 'go ',
    wrongContext: () => '',
    async run({ arg, context, location, env, hint }) {
      if (arg === '') {
        return error(
          context === 'lobby' || context === 'commons'
            ? `go where? try: go ${hint}`
            : 'go where? try: go 12, or the name of a room.',
        )
      }

      // A bare number is a post address, and post addresses only exist inside
      // rooms that keep things (§3.4, §3.10).
      if (/^\d+$/.test(arg)) {
        const id = Number(arg)
        if (context === 'lobby') {
          return error(`post numbers only work inside a room. try: go ${hint} first.`)
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
    verb: 'say',
    aliases: ['wall', 'post', 'reply', 'write', 'talk'],
    // §3.3 — one verb for all contribution. There is no `reply` verb to learn;
    // it exists only as an alias.
    contexts: ['room', 'commons', 'post'],
    gloss: (c) => (c === 'post' ? 'reply here' : c === 'commons' ? 'say something' : 'post something here'),
    detail: () =>
      'contributes wherever you’re standing. in a room it starts a new post; inside a post it adds a reply.',
    insert: () => 'say ',
    // §3.7 — the canonical example: name the fix, don't report a failure.
    wrongContext: (_c, hint) => `you have to be in a room first. try: go ${hint}`,
    async run({ arg, context, location, session }) {
      if (arg === '') {
        return error(
          context === 'post' ? 'say what? try: say i agree' : 'say what? type say and then your sentence.',
        )
      }

      // §3.9 — the sentence is captured first, then the account is asked for.
      // Friction lands at peak motivation, and nothing typed is ever lost.
      if (session.name() === null) {
        return { lines: session.begin({ location, body: arg }) }
      }

      return { lines: await session.write(location, arg) }
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
    detail: () => 'backs you out one level, from anywhere.',
    insert: () => 'leave',
    wrongContext: () => '',
    async run({ context, location, env }) {
      if (context === 'lobby') {
        return { lines: [{ text: 'you’re already at the lobby.', tone: 'faint' }] }
      }
      if (context === 'post') {
        const room = await env.getRoom(location.room!)
        if (!room) return { lines: renderRoomList(await env.listRooms()), location: {} }
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
      const lines: Line[] = [{ text: 'from here you can type:', tone: 'faint' }]
      for (const command of COMMANDS) {
        if (!command.contexts.includes(context)) continue
        lines.push({ text: `${command.verb} — ${command.gloss(context)}`, tone: 'dim' })
      }
      lines.push({ text: 'what <command> explains any of them.', tone: 'faint' })
      return { lines }
    },
  },
]

/**
 * §3.6 — the palette set changes by context, so it never exceeds ~6 items
 * regardless of how many commands exist. `what` and `help` sit at the lobby,
 * where a newcomer is standing; the doing verbs take the slots elsewhere.
 */
export const CHIP_SETS: Record<Context, readonly string[]> = {
  lobby: ['look', 'go', 'who', 'what', 'help'],
  room: ['look', 'go', 'say', 'who', 'leave'],
  commons: ['look', 'say', 'who', 'leave'],
  post: ['look', 'say', 'who', 'leave'],
}

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

/** §3.7 — unknown input guesses the nearest verb, and shows its description. */
export function nearestCommand(word: string): Command | undefined {
  const near = nearestSlug(word, allWords())
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
