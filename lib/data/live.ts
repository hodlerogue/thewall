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

        const arrival = async (params: Omit<Arrival, 'mine'>) => {
          // The location may have changed while the author name was being
          // resolved. Without this a message from a room you just left prints
          // under the room you just entered, with no attribution.
          if (closed) return
          append(arrivalLines({ ...params, mine: name }))
        }

        if (postId === null) {
          const ephemeral = ephemeralRooms.includes(room)
          opened.on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'posts', filter: `room_slug=eq.${room}` },
            async (payload) => {
              const row = payload.new as Row
              const author = await nameOf(client, row.author_id)
              await arrival({
                author,
                body: row.body,
                at: row.created_at,
                depth: 0,
                // Commons shows no numbers, because nothing there has an
                // address. Passed separately and never glued onto the name —
                // see `arrivalLines`.
                address: ephemeral ? undefined : row.post_no,
              })
            },
          )
        } else {
          opened.on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'replies', filter: `post_id=eq.${postId}` },
            async (payload) => {
              const row = payload.new as Row
              const author = await nameOf(client, row.author_id)
              await arrival({ author, body: row.body, at: row.created_at, depth: 1 })
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

export interface Arrival {
  /** Who wrote it, and nothing else. Never decorated. */
  author: string
  /** Who you are, so your own words are not read back to you. */
  mine: string | null
  body: string
  at: string
  /** 0 for a post arriving in a room, 1 for a reply arriving in a post. */
  depth: 0 | 1
  /** The post number, where the room has them. Absent in commons (§3.10). */
  address?: number
}

/**
 * What to print when somebody's words arrive live — or nothing, if they are
 * yours.
 *
 * Extracted and exported because the suppression had a bug that nothing could
 * see. The caller used to build the display string first — `20  ryan` — and
 * pass *that* as the author, so the check asking "is this mine" compared
 * `20  ryan` against `ryan` and never matched. Every post you made in a room
 * came straight back down the channel and printed underneath itself:
 *
 *     ryan:music$ say idk about that
 *     music/20
 *
 *     20  ryan, just now
 *     idk about that
 *
 * Commons was the only place it worked, because there the prefix is empty and
 * the two strings happened to be equal.
 *
 * So the address is its own field now and the name is never decorated before
 * the comparison. The type is the fix as much as the code is: there is no
 * longer a parameter you can pass a rendered string to.
 */
export function arrivalLines({ author, mine, body, at, depth, address }: Arrival): Line[] {
  if (mine !== null && author === mine) return []

  const head = `${address === undefined ? '' : `${address}  `}${author}, ${formatAgo(new Date(at))}`

  // §3.2 — a reply is one step in, its body two. Same shape live as it is when
  // read back.
  return depth === 0
    ? [
        { text: head, tone: 'dim' },
        { text: body, depth: 1 },
      ]
    : [
        { text: head, tone: 'dim', depth: 1 },
        { text: body, depth: 2 },
      ]
}
