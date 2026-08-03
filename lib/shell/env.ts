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

import { DEFAULT_ROOM, ROOMS } from '@/lib/shell/fixtures'
import type { Post, Room, RoomSummary } from '@/lib/shell/model'

export interface Presence {
  names: string[]
  guests: number
}

export interface Env {
  listRooms(): Promise<RoomSummary[]>
  getRoom(slug: string): Promise<Room | undefined>
  getPost(slug: string, id: number): Promise<Post | undefined>
  who(roomSlug: string | undefined): Promise<Presence>
}

/** In-memory Env over the §5 seed content, for tests and the mobile gate. */
export function fixtureEnv(rooms: Room[] = ROOMS): Env {
  const visiblePosts = (room: Room): Post[] =>
    // §3.10 — commons keeps nothing. The real enforcement is the select policy
    // in the schema; this mirrors it so the fixture behaves the same way.
    room.ephemeral
      ? room.posts.filter((p) => Date.now() - p.createdAt.getTime() < 24 * 60 * 60 * 1000)
      : room.posts

  return {
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
  }
}

export { DEFAULT_ROOM }
