import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { formatAgo } from '@/lib/shell/model'
import type { Line, Location } from '@/lib/shell/types'

/**
 * New posts and replies arriving while you are standing there.
 *
 * §6 put realtime in the stack for presence, and presence alone turned out not
 * to be enough: commons is described as a hallway (§3.10), and a hallway where
 * you cannot see someone speak until you type `look` is just a page.
 *
 * Everything here degrades to nothing. If the channel never connects you lose
 * live updates and keep a working prompt, which is the right way round.
 */

export interface Live {
  subscribe(location: Location, append: (lines: Line[]) => void): () => void
}

export function createLive(
  client: SupabaseClient,
  ephemeralRooms: readonly string[],
  currentUserId: () => string | null,
): Live {
  return {
    subscribe(location, append) {
      if (!location.room) return () => {}

      let channel: RealtimeChannel | null = null
      let cancelled = false

      const start = async () => {
        channel =
          location.postId === undefined
            ? await watchRoom(client, location.room!, ephemeralRooms, currentUserId, append)
            : await watchPost(client, location.room!, location.postId, currentUserId, append)

        // The location changed while we were setting up; drop it immediately.
        if (cancelled && channel) void client.removeChannel(channel)
      }

      void start().catch(() => {
        // A subscription that cannot start is not worth a line of scrollback.
      })

      return () => {
        cancelled = true
        if (channel) void client.removeChannel(channel)
      }
    },
  }
}

async function watchRoom(
  client: SupabaseClient,
  room: string,
  ephemeralRooms: readonly string[],
  currentUserId: () => string | null,
  append: (lines: Line[]) => void,
): Promise<RealtimeChannel> {
  const ephemeral = ephemeralRooms.includes(room)

  const channel = client
    .channel(`live:posts:${room}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'posts', filter: `room_slug=eq.${room}` },
      async (payload) => {
        const row = payload.new as {
          author_id: string
          post_no: number
          body: string
          created_at: string
        }
        // You already saw your own line when you sent it.
        if (row.author_id === currentUserId()) return

        const author = await nameOf(client, row.author_id)
        const when = formatAgo(new Date(row.created_at))

        append([
          {
            // Commons shows no numbers, because nothing there has an address.
            text: ephemeral ? `${author}, ${when}` : `${row.post_no}  ${author}, ${when}`,
            tone: 'dim',
          },
          { text: row.body, depth: 1 },
        ])
      },
    )

  channel.subscribe()
  return channel
}

async function watchPost(
  client: SupabaseClient,
  room: string,
  postNo: number,
  currentUserId: () => string | null,
  append: (lines: Line[]) => void,
): Promise<RealtimeChannel> {
  // Replies hang off the internal id, but a person types the address, so the
  // one has to be resolved into the other before anything can be filtered.
  const { data } = await client
    .from('posts')
    .select('id')
    .eq('room_slug', room)
    .eq('post_no', postNo)
    .maybeSingle()

  if (!data) throw new Error('no such post')

  const channel = client
    .channel(`live:replies:${room}:${postNo}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'replies', filter: `post_id=eq.${data.id}` },
      async (payload) => {
        const row = payload.new as { author_id: string; body: string; created_at: string }
        if (row.author_id === currentUserId()) return

        const author = await nameOf(client, row.author_id)
        append([
          // §3.2 — a reply is one step in, its body two. Same shape live as read.
          { text: `${author}, ${formatAgo(new Date(row.created_at))}`, tone: 'dim', depth: 1 },
          { text: row.body, depth: 2 },
        ])
      },
    )

  channel.subscribe()
  return channel
}

/** Small cache: a room's regulars turn up over and over. */
const names = new Map<string, string>()

async function nameOf(client: SupabaseClient, id: string): Promise<string> {
  const cached = names.get(id)
  if (cached) return cached

  const { data } = await client.from('profiles').select('name').eq('id', id).maybeSingle()
  const name = data?.name ?? 'someone'
  names.set(id, name)
  return name
}
