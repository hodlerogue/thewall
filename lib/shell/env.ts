/**
 * The seam between commands and data.
 *
 * Command handlers talk to this interface and nothing else, so Phase 3 can
 * replace the fixture implementation with Supabase without any handler
 * changing. Everything is async because the real one will be.
 */

import { DEFAULT_ROOM, ROOMS } from '@/lib/shell/fixtures'
import type { Post, Room, RoomSummary } from '@/lib/shell/model'

export interface Env {
  listRooms(): Promise<RoomSummary[]>
  getRoom(slug: string): Promise<Room | undefined>
  getPost(slug: string, id: number): Promise<Post | undefined>
  /** §3.9 — `who` has to be able to say that a guest isn't listed, and why. */
  who(roomSlug: string | undefined): Promise<string[]>
  currentName(): string | null
}

/** In-memory Env over the §5 seed content. Replaced in Phase 3. */
export function fixtureEnv(rooms: Room[] = ROOMS, name: string | null = null): Env {
  const visiblePosts = (room: Room): Post[] =>
    // §3.10 — commons keeps nothing. The real enforcement is an RLS policy in
    // Phase 3; this mirrors it so the fixture behaves the same way.
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
      return ['jameson', 'marisol', 'tuck']
    },
    currentName() {
      return name
    },
  }
}

export { DEFAULT_ROOM }
