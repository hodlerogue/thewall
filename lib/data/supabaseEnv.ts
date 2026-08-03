import type { SupabaseClient } from '@supabase/supabase-js'
import type { Presence } from '@/lib/data/presence'
import type { Env } from '@/lib/shell/env'
import type { Post, PostHit, Room, RoomSummary } from '@/lib/shell/model'

/**
 * The Env the commands actually run against.
 *
 * Every query here is a plain anonymous read — the policies in
 * `20260803000000_initial_schema.sql` decide what comes back. In particular
 * nothing filters for commons expiry, because the select policy already does
 * (§3.10); if that were done here instead, every future query would have to
 * remember to do it too.
 */
export function supabaseEnv(client: SupabaseClient, presence?: Presence): Env {
  return {
    async listRooms(): Promise<RoomSummary[]> {
      // §3.11 — one round trip for the whole lobby, including proof of life.
      const { data, error } = await client
        .from('room_overview')
        .select('slug, gloss, ephemeral, latest_body, latest_at, latest_author')
        .order('sort_order')

      if (error) throw error

      return (data ?? []).map((row) => ({
        slug: row.slug,
        gloss: row.gloss,
        ephemeral: row.ephemeral,
        latest:
          row.latest_body && row.latest_at
            ? {
                author: row.latest_author ?? 'someone',
                body: row.latest_body,
                createdAt: new Date(row.latest_at),
              }
            : undefined,
      }))
    },

    async getRoom(slug: string): Promise<Room | undefined> {
      const { data: room, error: roomError } = await client
        .from('rooms')
        .select('slug, gloss, ephemeral')
        .eq('slug', slug)
        .maybeSingle()

      if (roomError) throw roomError
      if (!room) return undefined

      const { data: posts, error: postsError } = await client
        .from('posts')
        .select('post_no, body, created_at, author:profiles(name), replies(count)')
        .eq('room_slug', slug)
        .order('created_at', { ascending: false })
        .limit(30)

      if (postsError) throw postsError

      return {
        slug: room.slug,
        gloss: room.gloss,
        ephemeral: room.ephemeral,
        posts: (posts ?? []).map((row) => ({
          id: row.post_no,
          author: authorName(row.author),
          body: row.body,
          createdAt: new Date(row.created_at),
          // The listing only needs the count; the bodies arrive when you go in.
          replies: Array.from({ length: replyCount(row.replies) }, () => ({
            author: '',
            body: '',
            createdAt: new Date(0),
          })),
        })),
      }
    },

    async getPost(slug: string, id: number): Promise<Post | undefined> {
      const { data, error } = await client
        .from('posts')
        .select(
          'post_no, body, created_at, author:profiles(name), replies(body, created_at, author:profiles(name))',
        )
        .eq('room_slug', slug)
        .eq('post_no', id)
        .maybeSingle()

      if (error) throw error
      if (!data) return undefined

      const replies = (data.replies ?? []) as unknown as RawReply[]

      return {
        id: data.post_no,
        author: authorName(data.author),
        body: data.body,
        createdAt: new Date(data.created_at),
        replies: replies
          .map((reply) => ({
            author: authorName(reply.author),
            body: reply.body,
            createdAt: new Date(reply.created_at),
          }))
          // §4.3 — flat and chronological. There is no tree to sort.
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      }
    },

    async who() {
      // Who is actually here, from the room's realtime channel — not who has
      // an account. Without a channel (server-side render), nobody is "here".
      return presence?.present() ?? { names: [], guests: 0 }
    },

    async searchPosts(query): Promise<PostHit[]> {
      let request = client
        .from('posts')
        // Ephemeral rooms are excluded: their posts have no permanent address,
        // so a hit from commons would be somewhere you cannot `go` (§3.10).
        .select('post_no, body, created_at, room_slug, rooms!inner(ephemeral), author:profiles!inner(name)')
        .eq('rooms.ephemeral', false)
        .order('created_at', { ascending: false })
        .limit(query.limit)

      if (query.room) request = request.eq('room_slug', query.room)
      if (query.by) request = request.eq('profiles.name', query.by)
      if (query.since) request = request.gte('created_at', query.since.toISOString())

      const { data, error } = await request
      if (error) throw error

      return (data ?? []).map((row) => ({
        room: row.room_slug,
        id: row.post_no,
        author: authorName(row.author),
        body: row.body,
        createdAt: new Date(row.created_at),
      }))
    },
  }
}

interface RawReply {
  body: string
  created_at: string
  author: { name: string } | { name: string }[] | null
}

/** PostgREST embeds a to-one relationship as an object or a one-element array. */
function authorName(author: { name: string } | { name: string }[] | null): string {
  if (!author) return 'someone'
  const one = Array.isArray(author) ? author[0] : author
  return one?.name ?? 'someone'
}

function replyCount(replies: unknown): number {
  if (Array.isArray(replies)) {
    const first = replies[0] as { count?: number } | undefined
    return first?.count ?? 0
  }
  return 0
}
