/**
 * Domain types. Phase 2 fills these from fixtures and Phase 3 fills them from
 * Supabase — the renderer and the command handlers never learn which.
 */

export interface Reply {
  author: string
  body: string
  createdAt: Date
}

export interface Post {
  /**
   * Permanent and never positional (§3.4). Allocated per room and never
   * reused, so post 12 is post 12 forever and `/music/12` always resolves.
   */
  id: number
  author: string
  body: string
  createdAt: Date
  replies: Reply[]
}

export interface Room {
  slug: string
  gloss: string
  /**
   * Whose wall this is, if it is one. Absent for the curated rooms.
   *
   * A wall is a room with an owner rather than a new kind of object, so every
   * address, lever and query already reaches it — and the one thing it does not
   * get is a place in the lobby (§4.2).
   */
  owner?: string
  /**
   * Who opened it, when somebody did. Absent for the curated rooms.
   *
   * Separate from `owner`, which means "this is that person's wall" and carries
   * a `~` address with it. Making a room does not make it yours: it has no
   * moderator, and the person who opened it has exactly the powers everybody
   * else in it has.
   */
  madeBy?: string
  /**
   * The room somebody was standing in when they made this one, if any.
   *
   * A label for discovery, never part of an address and never a permission —
   * see `20260806020000_rooms_grew_out_of.sql` for why nesting was not the
   * answer. Fixture-side counterpart of `rooms.from_room`.
   */
  fromRoom?: string
  /** §3.10 — commons keeps nothing. Posts expire, no IDs, no threads. */
  ephemeral: boolean
  /**
   * Rooms somebody opened while standing in this one.
   *
   * Subtopics without a tree: they are ordinary rooms with ordinary addresses,
   * and this is the only thing connecting them. Present but empty for a room
   * nobody has branched off.
   */
  grewOut?: { slug: string; gloss: string }[]
  /** The newest page of them, oldest-first once rendered. */
  posts: Post[]
  /**
   * Whether there are older posts than the ones in `posts`.
   *
   * Not derivable from `posts.length === ROOM_PAGE`: asking for a page and
   * getting a full one is the same answer whether there is one more post or
   * ten thousand, and a room with exactly a page in it would be told it had
   * extras it does not. Both Envs answer this by fetching one more than they
   * intend to show and reporting whether it arrived.
   */
  more?: boolean
}

/** §3.11 — what the lobby shows so it reads as a building, not a list of doors. */
export interface RoomSummary {
  slug: string
  gloss: string
  ephemeral: boolean
  /**
   * False when somebody made this rather than it being seeded or opened by the
   * operator. The lobby keeps the curated ones together and above, which is the
   * whole of §4.2's mitigation now that anyone can open a door.
   */
  curated: boolean
  latest?: { author: string; body: string; createdAt: Date }
}

/**
 * A room as a search result, which is a different question from a room in the
 * lobby: here you already know it might not be in the lobby, and want to know
 * whether it is worth walking to.
 */
export interface RoomHit {
  slug: string
  gloss: string
  curated: boolean
  /** False once it has gone quiet: still reachable, just not in the listing. */
  inLobby: boolean
  posts: number
  latestAt?: Date
}

/**
 * A post found by searching rather than by standing somewhere, so it carries
 * its own address (§4.8). Room included because a search crosses rooms and the
 * result has to stay something you can `go` to.
 */
export interface PostHit {
  room: string
  id: number
  author: string
  body: string
  createdAt: Date
  /**
   * True when the words are a reply rather than the post itself. The address is
   * still the post's, because that is where the reply lives and what you would
   * type to go and read it (§4.3 — replies have no addresses of their own).
   */
  isReply?: boolean
  /**
   * How many answers it has, where that is known.
   *
   * Absent for a search hit, which is a needle rather than a thing to browse.
   * The feed is a listing, and there "three replies" is most of what decides
   * whether to open something.
   */
  replies?: number
}

/**
 * Somebody, as a view rather than a place (§3.10).
 *
 * There is no `posts` field that belongs *to* the profile — `posts` here are
 * PostHits, which means every one of them carries the room and id it actually
 * lives at. That is the whole design: a profile is a set of doors back into
 * rooms, never a room of its own.
 */
export interface Profile {
  name: string
  joinedAt: Date
  /** §4.7 — whether they ever followed a key. Shown, never used to hide them. */
  verified: boolean
  posts: PostHit[]
  /**
   * §4.6 — when this name was last somebody else's, if it recently was.
   *
   * Names are released the moment they are dropped, so a handle can change
   * hands. This is the whole mitigation for that: the reader, who is the person
   * impersonation is actually aimed at, is told. It is a date and never a
   * person — publishing *whose* it was would make renaming useless to the one
   * person §4.6 exists for, someone walking away from a name they regret.
   */
  nameChangedHands?: Date
}

export interface PostQuery {
  /** Words to look for in the body. The commonest thing anyone wants. */
  text?: string
  room?: string
  by?: string
  since?: Date
  limit: number
}

/** Coarse on purpose: "2h ago" is the resolution a conversation actually has. */
export function formatAgo(then: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
