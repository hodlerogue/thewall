import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import type { Presence } from '@/lib/shell/env'
import { formatAgo } from '@/lib/shell/model'
import type { Line, Location } from '@/lib/shell/types'

/**
 * Everything that is true about *where you are standing right now*: who else is
 * here, and what they say while you're here.
 *
 * These used to be two mechanisms. Presence lived in its own module and was
 * wired exactly once, at boot — so `who` answered with whatever room you first
 * landed in, forever, and you never appeared to anyone in a room you walked
 * into. Live arrivals were a second channel with its own lifecycle. Both are
 * the same question, so they are now one channel with one lifetime, opened and
 * closed by the only thing that decides either: your location.
 *
 * Everything degrades to nothing. A channel that will not connect costs live
 * updates and an empty `who`, and leaves a working prompt.
 */

export interface Live {
  /** Open the channel for a location. Returns the close. */
  subscribe(
    location: Location,
    name: string | null,
    append: (lines: Line[]) => void,
  ): () => void
  /** Who is in the room currently subscribed to. */
  present(): Presence
}

export function createLive(client: SupabaseClient, ephemeralRooms: readonly string[]): Live {
  let channel: RealtimeChannel | null = null

  return {
    present(): Presence {
      if (!channel) return { names: [], guests: 0 }

      const state = channel.presenceState<{ name: string | null }>()
      const names = new Set<string>()
      let guests = 0

      for (const entries of Object.values(state)) {
        for (const entry of entries) {
          if (entry.name) names.add(entry.name)
          // Guests are counted but not named — `who` says how many are reading
          // without pretending they are people you can address (§3.9).
          else guests += 1
        }
      }
      return { names: [...names].sort(), guests }
    },

    subscribe(location, name, append) {
      // Nothing to be present in at the lobby: it is a directory, not a room.
      if (!location.room) return () => {}

      let closed = false
      let mine: RealtimeChannel | null = null

      const open = async () => {
        const room = location.room!
        const opened = client.channel(`here:${room}`, {
          config: { presence: { key: name ?? anonymousKey() } },
        })

        // A reply belongs to a post id; a person types an address. Resolving
        // one into the other has to happen before the filter can be built.
        let postId: number | null = null
        if (location.postId !== undefined) {
          const { data, error } = await client
            .from('posts')
            .select('id')
            .eq('room_slug', room)
            .eq('post_no', location.postId)
            .maybeSingle()
          // Discarding this error used to leave live replies silently dead in a
          // post — indistinguishable from nobody replying.
          if (error) throw error
          postId = data?.id ?? null
        }

        const arrival = async (author: string, body: string, at: string, depth: 0 | 1) => {
          // You saw your own words when you sent them. Comparing names rather
          // than ids is deliberate: names are unique, and the id is not
          // reliably known — signup completes server-side via Set-Cookie, so
          // the browser client never fires an auth event to learn it.
          if (name !== null && author === name) return
          // The location may have changed while the author name was being
          // resolved. Without this a message from a room you just left prints
          // under the room you just entered, with no attribution.
          if (closed) return

          append(
            depth === 0
              ? [
                  { text: `${author}, ${formatAgo(new Date(at))}`, tone: 'dim' },
                  { text: body, depth: 1 },
                ]
              : // §3.2 — a reply is one step in, its body two. Same shape live
                // as it is when read.
                [
                  { text: `${author}, ${formatAgo(new Date(at))}`, tone: 'dim', depth: 1 },
                  { text: body, depth: 2 },
                ],
          )
        }

        if (postId === null) {
          const ephemeral = ephemeralRooms.includes(room)
          opened.on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'posts', filter: `room_slug=eq.${room}` },
            async (payload) => {
              const row = payload.new as Row
              const author = await nameOf(client, row.author_id)
              // Commons shows no numbers, because nothing there has an address.
              const prefix = ephemeral ? '' : `${row.post_no}  `
              await arrival(`${prefix}${author}`, row.body, row.created_at, 0)
            },
          )
        } else {
          opened.on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'replies', filter: `post_id=eq.${postId}` },
            async (payload) => {
              const row = payload.new as Row
              const author = await nameOf(client, row.author_id)
              await arrival(author, row.body, row.created_at, 1)
            },
          )
        }

        opened.subscribe(async (status) => {
          if (status !== 'SUBSCRIBED' || closed) return
          await opened.track({ name })
        })

        mine = opened
        channel = opened

        // Location changed while this was being set up.
        if (closed) void teardown()
      }

      const teardown = async () => {
        if (mine) {
          if (channel === mine) channel = null
          const going = mine
          mine = null
          await client.removeChannel(going)
        }
      }

      void open().catch(() => {
        // A channel that cannot open is not worth a line of scrollback.
      })

      return () => {
        closed = true
        void teardown()
      }
    },
  }
}

interface Row {
  author_id: string
  post_no: number
  body: string
  created_at: string
}

/** Small cache: a room's regulars turn up over and over. */
const names = new Map<string, string>()

async function nameOf(client: SupabaseClient, id: string): Promise<string> {
  const cached = names.get(id)
  if (cached) return cached

  const { data, error } = await client.from('profiles').select('name').eq('id', id).maybeSingle()
  // Never cache a failure. Doing so pinned a real person to "someone" for the
  // life of the page, while `look` kept showing their actual name — the same
  // user under two names in one scrollback.
  if (error || !data?.name) return 'someone'

  names.set(id, data.name)
  return data.name
}

function anonymousKey(): string {
  return `guest-${Math.random().toString(36).slice(2, 10)}`
}
