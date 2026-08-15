import type { Env } from '@/lib/shell/env'
import type { Room, RoomList } from '@/lib/shell/model'
import type { Location } from '@/lib/shell/types'

/**
 * The reads the first screen needs, all started at once.
 *
 * This exists as a function rather than four lines inside `Shell` for one
 * reason: what it does is a *timing* property, and timing is the one thing a
 * component this shape cannot be tested for. Boot used to run its requests nose
 * to tail — the session, then the profile, then the room list, then the room,
 * then the mail count — and nothing anywhere would have noticed it going back
 * to that. Every suite would still pass. The screen would just be slower.
 *
 * Only one of those orderings was ever a real dependency: the profile lookup
 * needs the id the session returns. What the rooms are, and what is in the room
 * somebody is arriving at, has nothing to do with who they are.
 *
 * A promise starts running the moment it is made, so returning promises rather
 * than values is the whole mechanism — the caller awaits them when it needs
 * them, by which time they have been in flight the entire time it was doing
 * something else.
 *
 * On a fast connection to a nearby database the old ordering cost little enough
 * to miss. On a free-tier project a continent away it is the difference between
 * a prompt in half a second and a prompt in three, spent looking at `…`.
 */
export interface ArrivalReads {
  rooms: Promise<RoomList>
  /**
   * The room being arrived at, when the address names one.
   *
   * Absent for the lobby, for a profile and for the feed — all of which either
   * need no room or get theirs another way. Absent is not an error; the caller
   * falls back to fetching it, which is what the old code always did.
   */
  room: Promise<Room | undefined> | undefined
}

export function startArrivalReads(env: Env, target: Location): ArrivalReads {
  const wanted =
    target.person === undefined && target.room !== undefined && target.room !== 'feed'
      ? target.room
      : undefined

  const room = wanted === undefined ? undefined : env.getRoom(wanted)

  /*
   * A handler attached the moment the promise exists, not when it is awaited.
   *
   * Between here and the await there is a session lookup, which is long enough
   * for a rejection to be seen as unhandled — and an unhandled rejection is
   * reported by browsers as an error the site did not catch, on the one path
   * where the site catches everything and says something useful about it.
   */
  room?.catch(() => {})

  return { rooms: env.listRooms(), room }
}

/**
 * The one line of instruction on the first screen, matched to where you landed.
 *
 * It used to say `look` from everywhere, and the first screen is
 * server-rendered — so the room, the lobby or the post is already on screen
 * before anybody reads the line telling them to ask for it. Walked as a
 * newcomer: land in commons, do as you are told, and watch the same three items
 * print again underneath a line saying you asked for them. The first command
 * anybody runs taught that commands repeat what is already there.
 *
 * So it names the thing that is *not* on screen. From the lobby the list of
 * rooms is what you are looking at and a room is what you have not seen; from
 * anywhere else it is the other way round.
 *
 * The lobby line says "a name from the list" rather than naming a room. A
 * concrete example gets copied exactly — that is how a room ended up called
 * `onions` glossed "what you are growing" — and the names it would be choosing
 * between are already on the screen underneath.
 */
export function openingHint(location: Location): string {
  const inTheLobby =
    location.room === undefined && location.postId === undefined && location.person === undefined

  return inTheLobby
    ? 'type go and a name from the list to walk into a room, or tap a command below.'
    : 'type rooms to see what else is going on, or tap a command below.'
}
