/**
 * PHASE 1 SCAFFOLDING — deleted in Phase 2.
 *
 * Just enough behaviour to drive the shell on a phone: navigation, indentation,
 * scrollback growth, palette insertion. No aliases, no fuzzy matching, no
 * teaching errors — those belong to the command registry and are the point of
 * Phase 2. Nothing here is meant to survive.
 */

import { EPHEMERAL_ROOMS, ROOMS, findPost, findRoom } from '@/lib/shell/fixtures'
import { renderPost, renderRoom, renderRoomList } from '@/lib/shell/render'
import type { Chip, Line, Location, RunResult } from '@/lib/shell/types'
import { contextOf } from '@/lib/shell/types'

export function phase1Run(input: string, location: Location): RunResult {
  const [verb, ...rest] = input.split(/\s+/)
  const arg = rest.join(' ')
  const context = contextOf(location, EPHEMERAL_ROOMS)

  if (verb === 'look') {
    if (context === 'lobby') return { lines: renderRoomList(ROOMS) }
    const room = findRoom(location.room!)!
    if (context === 'post') return { lines: renderPost(room, findPost(room.slug, location.postId!)!) }
    return { lines: renderRoom(room) }
  }

  if (verb === 'go') {
    if (context === 'lobby') {
      const room = findRoom(arg)
      if (!room) return { lines: [{ text: `no room called ${arg}. try: look`, tone: 'error' }] }
      return { lines: renderRoom(room), location: { room: room.slug } }
    }
    if (context === 'room') {
      const room = findRoom(location.room!)!
      const post = findPost(room.slug, Number(arg))
      if (!post) return { lines: [{ text: `no post ${arg} in ${room.slug}. try: look`, tone: 'error' }] }
      return { lines: renderPost(room, post), location: { room: room.slug, postId: post.id } }
    }
    return { lines: [{ text: 'nothing to go into from here.', tone: 'error' }] }
  }

  if (verb === 'leave') {
    if (context === 'post') {
      const room = findRoom(location.room!)!
      return { lines: renderRoom(room), location: { room: room.slug } }
    }
    if (context === 'lobby') return { lines: [{ text: 'you are already at the lobby.', tone: 'faint' }] }
    return { lines: renderRoomList(ROOMS), location: {} }
  }

  if (verb === 'say') {
    return { lines: [{ text: '(phase 1: say arrives with signup in phase 4)', tone: 'faint' }] }
  }

  if (verb === 'who') {
    return {
      lines: [
        { text: 'jameson, marisol, tuck', tone: 'dim' },
        { text: 'you are reading as a guest — you are not on this list yet.', tone: 'faint' },
      ],
    }
  }

  return { lines: [{ text: `i don't know "${verb}". (phase 2 teaches this properly)`, tone: 'error' }] }
}

const LOBBY_CHIPS: Chip[] = [
  { verb: 'look', gloss: 'see what’s around you', insert: 'look' },
  { verb: 'go', gloss: 'enter a room', insert: 'go ' },
  { verb: 'what', gloss: 'what a command does', insert: 'what ' },
  { verb: 'help', gloss: 'everything you can type', insert: 'help' },
]

const ROOM_CHIPS: Chip[] = [
  { verb: 'look', gloss: 'see what’s here', insert: 'look' },
  { verb: 'go', gloss: 'open a post', insert: 'go ' },
  { verb: 'say', gloss: 'post something here', insert: 'say ' },
  { verb: 'who', gloss: 'who’s around', insert: 'who' },
  { verb: 'leave', gloss: 'back to the lobby', insert: 'leave' },
]

const COMMONS_CHIPS: Chip[] = [
  { verb: 'look', gloss: 'see what’s here', insert: 'look' },
  { verb: 'say', gloss: 'say something', insert: 'say ' },
  { verb: 'who', gloss: 'who’s around', insert: 'who' },
  { verb: 'leave', gloss: 'back to the lobby', insert: 'leave' },
]

const POST_CHIPS: Chip[] = [
  { verb: 'look', gloss: 'read it again', insert: 'look' },
  { verb: 'say', gloss: 'reply here', insert: 'say ' },
  { verb: 'who', gloss: 'who’s around', insert: 'who' },
  { verb: 'leave', gloss: 'back to the room', insert: 'leave' },
]

/** §3.6 — the set changes by context, so it never exceeds ~6 items. */
export function phase1Chips(location: Location): readonly Chip[] {
  switch (contextOf(location, EPHEMERAL_ROOMS)) {
    case 'lobby':
      return LOBBY_CHIPS
    case 'commons':
      return COMMONS_CHIPS
    case 'post':
      return POST_CHIPS
    default:
      return ROOM_CHIPS
  }
}

/** §3.10 — you start in commons, and it is a peer room, not special structure. */
export function phase1Intro(): Line[] {
  return [
    { text: 'thewall.sh', tone: 'accent' },
    { text: 'type look to see what’s around you, or tap a command below.', tone: 'faint' },
    { text: '' },
    ...renderRoom(findRoom('commons')!),
  ]
}
