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
  /** §3.10 — commons keeps nothing. Posts expire, no IDs, no threads. */
  ephemeral: boolean
  posts: Post[]
}

/** §3.11 — what the lobby shows so it reads as a building, not a list of doors. */
export interface RoomSummary {
  slug: string
  gloss: string
  ephemeral: boolean
  latest?: { author: string; body: string; createdAt: Date }
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
