/**
 * The seam between commands and data.
 *
 * Command handlers talk to this interface and nothing else, so the fixture
 * implementation and the Supabase one are interchangeable. Everything is async
 * because the real one is.
 *
 * Identity deliberately does not live here — the Session owns that (§3.9),
 * because who you are is a property of the conversation, not of the data.
 */

import { DEFAULT_ROOM, PEOPLE, ROOMS } from '@/lib/shell/fixtures'
import type { Post, PostHit, PostQuery, Profile, Room, RoomSummary } from '@/lib/shell/model'

export interface Presence {
  names: string[]
  guests: number
}

/** §4.1 — a reply to something you said, with the address to walk to. */
export interface MailItem {
  room: string
  postId: number
  author: string
  body: string
  createdAt: Date
}

/** One thing `doctor` checked, and what it found (§7 — the operator's day one). */
export interface Check {
  label: string
  ok: boolean
  note?: string
}

export interface Env {
  listRooms(): Promise<RoomSummary[]>
  getRoom(slug: string): Promise<Room | undefined>
  getPost(slug: string, id: number): Promise<Post | undefined>
  who(roomSlug: string | undefined): Promise<Presence>
  /** §4.8 — the pipe's source. Crosses rooms, so hits carry their address. */
  searchPosts(query: PostQuery): Promise<PostHit[]>
  /** §4.1 — how many replies are waiting. Zero for anyone without a name. */
  mailCount(): Promise<number>
  /** §4.1 — the replies themselves. Reading them marks them read. */
  readMail(): Promise<MailItem[]>
  /**
   * §3.10 — somebody, as a view. The posts come back as hits, carrying their
   * real addresses, because a profile is a way back into rooms and not a room.
   */
  getProfile(name: string): Promise<Profile | undefined>
  /**
   * What is true about this deployment right now.
   *
   * Exists because two separate failures — an unapplied migration and a magic
   * link that never worked — presented as the same sentence on screen, and
   * neither could be told apart from "the fix is not deployed yet" without
   * reading server logs nobody has open.
   */
  diagnose(): Promise<Check[]>
}

/** In-memory Env over the §5 seed content, for tests and the mobile gate. */
export function fixtureEnv(rooms: Room[] = ROOMS): Env {
  const visiblePosts = (room: Room): Post[] =>
    // §3.10 — commons keeps nothing. The real enforcement is the select policy
    // in the schema; this mirrors it so the fixture behaves the same way.
    room.ephemeral
      ? room.posts.filter((p) => Date.now() - p.createdAt.getTime() < 24 * 60 * 60 * 1000)
      : room.posts

  // Named rather than returned inline, so getProfile can reuse searchPosts
  // instead of restating the query that decides what a person's posts are.
  const env: Env = {
    async listRooms() {
      return rooms.map((room) => {
        const latest = visiblePosts(room)[0]
        return {
          slug: room.slug,
          gloss: room.gloss,
          ephemeral: room.ephemeral,
          latest: latest
            ? { author: latest.author, body: latest.body, createdAt: latest.createdAt }
            : undefined,
        }
      })
    },
    async getRoom(slug) {
      const room = rooms.find((r) => r.slug === slug)
      return room ? { ...room, posts: visiblePosts(room) } : undefined
    },
    async getPost(slug, id) {
      const room = rooms.find((r) => r.slug === slug)
      if (!room || room.ephemeral) return undefined
      return room.posts.find((p) => p.id === id)
    },
    async who() {
      return { names: ['jameson', 'marisol', 'tuck'], guests: 2 }
    },

    async mailCount() {
      return 0
    },

    async readMail() {
      return []
    },

    async searchPosts(query) {
      const hits = rooms
        // Ephemeral rooms are skipped: their posts have no permanent address,
        // so a result from commons would be something you cannot `go` to.
        .filter((room) => !room.ephemeral && (query.room === undefined || room.slug === query.room))
        .flatMap((room) =>
          room.posts.map((post) => ({
            room: room.slug,
            id: post.id,
            author: post.author,
            body: post.body,
            createdAt: post.createdAt,
          })),
        )
        .filter((hit) => query.by === undefined || hit.author === query.by)
        .filter(
          (hit) =>
            query.text === undefined || hit.body.toLowerCase().includes(query.text.toLowerCase()),
        )
        .filter((hit) => query.since === undefined || hit.createdAt >= query.since)

      hits.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      return hits.slice(0, query.limit)
    },

    async diagnose() {
      return [{ label: 'data', ok: true, note: 'fixtures — nothing here is real' }]
    },

    async getProfile(name) {
      const person = PEOPLE.find((p) => p.name === name.toLowerCase())
      if (!person) return undefined
      return {
        name: person.name,
        joinedAt: person.joinedAt,
        verified: person.verified,
        nameChangedHands: person.nameChangedHands,
        // The same query `find --by=marisol` runs, which is what keeps a
        // profile from being able to show anything a search could not.
        posts: await env.searchPosts({ by: person.name, limit: 10 }),
      }
    },
  }

  return env
}

export { DEFAULT_ROOM }
