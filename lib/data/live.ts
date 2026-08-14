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
      const room = location.room

      let closed = false
      let mine: RealtimeChannel | null = null
      let postId: number | null = null
      let retry: ReturnType<typeof setTimeout> | null = null
      let attempt = 0

      /**
       * The newest thing already accounted for, as the database timestamped it.
       *
       * Read from the database rather than taken from `Date.now()`, because a
       * phone whose clock is a few seconds off would otherwise either re-print
       * messages it has already shown or skip ones it has not.
       */
      let seen: string | null = null

      /**
       * Rows already on the screen, by id.
       *
       * Reported from two browsers side by side: something said in one arrived
       * in the other twice, one under the other. The watermark alone could not
       * prevent that, because it moves *after* two awaits — the query, then the
       * author lookup — and anything that runs in that window reads the old
       * value and fetches the same row again. Two things run in that window in
       * normal use: a live arrival, and a second catch-up. Flipping between two
       * windows fires `visibilitychange` on every switch, which is what the
       * side-by-side test does over and over.
       *
       * Ordering the awaits more carefully narrows the window without closing
       * it. An id that has been printed is a fact, so this asks that instead.
       */
      const printed = new Set<number>()
      const isNew = (id: number | undefined): boolean => {
        // Nothing to go on — better a possible repeat than a dropped message.
        if (id === undefined) return true
        if (printed.has(id)) return false
        printed.add(id)
        // A Set iterates in insertion order, so this drops the oldest. The cap
        // is far past anything one sitting in one room prints.
        while (printed.size > REMEMBER) {
          for (const oldest of printed) {
            printed.delete(oldest)
            break
          }
        }
        return true
      }

      /**
       * Everything said while nobody was listening.
       *
       * This is the half that was missing, and it is not the same as
       * reconnecting. `postgres_changes` is a live feed with no replay: when
       * the socket goes — and on a phone it goes every time the app leaves the
       * screen, because the system suspends the page — whatever arrives during
       * the gap is not queued anywhere. Reconnecting gets you the *next*
       * message and never the ones you missed.
       *
       * Reported exactly that way: a room open on a home-screen app, a second
       * browser saying something, and nothing appearing until "i had to leave
       * and go back in" — which worked because walking out of a room and back
       * re-reads it.
       */
      /*
       * One at a time, in order.
       *
       * `subscribe` runs one on joining and `visibilitychange` runs one on every
       * return, so two could overlap — both reading the same watermark, both
       * fetching the same rows. Chained rather than coalesced: a request that
       * arrives mid-flight still runs afterwards, so nothing is dropped on the
       * floor to save a query.
       */
      let queue: Promise<void> = Promise.resolve()
      const catchUp = (): Promise<void> => {
        queue = queue.then(runCatchUp).catch(() => {})
        return queue
      }

      const runCatchUp = async () => {
        if (closed || seen === null) return

        const query =
          postId === null
            ? client
                .from('posts')
                .select('id, author_id, post_no, body, created_at')
                .eq('room_slug', room)
            : client.from('replies').select('id, author_id, body, created_at').eq('post_id', postId)

        const { data, error } = await query
          .gt('created_at', seen)
          .order('created_at', { ascending: true })
          .limit(CATCH_UP + 1)

        if (error || !data?.length || closed) return

        const ephemeral = ephemeralRooms.includes(room)

        /*
         * Claimed, and the watermark moved, before the author lookup below —
         * which is a network call whenever the author has not been seen before.
         * Both used to happen after it, so anything running in that window read
         * a watermark that had not moved and fetched these very rows again.
         *
         * The id set is the guarantee and this ordering is the belt: even with
         * the watermark stale, a row already printed is not printed twice.
         *
         * Over the cap the watermark jumps the whole backlog rather than
         * landing on the last row fetched — `look` is the way to read what was
         * skipped, so a marker mid-backlog would dribble out another twenty old
         * messages on every later return, and the row fetched only to learn
         * there *was* more would be counted read without being printed.
         */
        const rows = (data.slice(0, CATCH_UP) as Row[]).filter((row) => isNew(row.id))
        const over = data.length > CATCH_UP
        seen = over ? await newest(client, room, postId) : data[data.length - 1].created_at

        // Everything waiting had already been printed by something else.
        if (!rows.length) return

        const authors = await namesOf(client, rows.map((row) => row.author_id))
        if (closed) return

        const lines: Line[] = []
        for (const row of rows) {
          lines.push(
            ...arrivalLines({
              author: authors.get(row.author_id) ?? 'someone',
              mine: name,
              body: row.body,
              at: row.created_at,
              depth: postId === null ? 0 : 1,
              address: postId === null && !ephemeral ? row.post_no : undefined,
            }),
          )
        }

        /*
         * Away long enough that this would be a wall of text. Printing the
         * first twenty and saying so beats both alternatives: silently dropping
         * the rest, and pasting four hundred lines into a scrollback somebody
         * is about to type into.
         */
        if (over) {
          lines.push({ text: '…and more. type look to read the room.', tone: 'faint', hint: true })
        }

        if (lines.length && !closed) append(lines)
      }

      const open = async () => {
        const opened = client.channel(`here:${room}`, {
          config: { presence: { key: name ?? anonymousKey() } },
        })

        // A reply belongs to a post id; a person types an address. Resolving
        // one into the other has to happen before the filter can be built.
        if (location.postId !== undefined && postId === null) {
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

        // Where to start counting from, before anything can arrive. On a
        // reconnect `seen` is already set and keeps its place, which is what
        // makes the catch-up cover the whole time away rather than none of it.
        if (seen === null) seen = await newest(client, room, postId)

        const arrival = (params: Omit<Arrival, 'mine'>) => {
          // The location may have changed while the author name was being
          // resolved. Without this a message from a room you just left prints
          // under the room you just entered, with no attribution.
          if (closed) return
          append(arrivalLines({ ...params, mine: name }))
        }

        /*
         * Claimed the moment the row lands, before the author lookup it has to
         * wait on. Doing it afterwards left a window in which a catch-up read a
         * watermark that had not moved yet and fetched this very row again —
         * which is how the same message came out twice, one under the other.
         */
        const claim = (row: Row): boolean => {
          if (!isNew(row.id)) return false
          if (row.created_at > (seen ?? '')) seen = row.created_at
          return true
        }

        if (postId === null) {
          const ephemeral = ephemeralRooms.includes(room)
          opened.on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'posts', filter: `room_slug=eq.${room}` },
            async (payload) => {
              const row = payload.new as Row
              if (!claim(row)) return
              const author = await nameOf(client, row.author_id)
              arrival({
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
              if (!claim(row)) return
              const author = await nameOf(client, row.author_id)
              arrival({ author, body: row.body, at: row.created_at, depth: 1 })
            },
          )
        }

        opened.subscribe(async (status) => {
          if (closed) return
          if (status === 'SUBSCRIBED') {
            attempt = 0
            await opened.track({ name })
            // Anything said between losing the last channel and joining this
            // one. On a first open there is nothing to find, and it costs one
            // query to be sure of that.
            await catchUp()
            return
          }
          /*
           * The other three statuses used to fall out of this function without
           * a word, which meant a channel that errored or timed out stayed dead
           * for as long as the room was open. Nothing said so: the prompt kept
           * working and the room simply stopped moving, which is the failure
           * this whole module is supposed to make impossible.
           */
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            schedule()
          }
        })

        mine = opened
        channel = opened

        // Location changed while this was being set up.
        if (closed) void teardown()
      }

      /** Try again, backing off, and never faster than a person can read. */
      const schedule = () => {
        if (closed || retry !== null) return
        const wait = BACKOFF[Math.min(attempt, BACKOFF.length - 1)]
        attempt += 1
        retry = setTimeout(() => {
          retry = null
          if (closed) return
          void teardown().then(open).catch(schedule)
        }, wait)
      }

      const teardown = async () => {
        if (retry !== null) {
          clearTimeout(retry)
          retry = null
        }
        if (mine) {
          if (channel === mine) channel = null
          const going = mine
          mine = null
          await client.removeChannel(going)
        }
      }

      /*
       * Coming back to the app is the moment that matters, and until now
       * nothing anywhere in this codebase listened for it. A page the system
       * suspended has a socket that is either dead or about to be, and messages
       * behind it that no reconnect will ever deliver.
       */
      const onVisible = () => {
        if (closed || document.visibilityState !== 'visible') return
        attempt = 0

        /*
         * Two different returns, and treating them the same is wasteful in one
         * direction and wrong in the other.
         *
         * On a computer, switching tabs and switching back usually leaves the
         * socket exactly where it was. Tearing the channel down and building
         * another one every time somebody glances at their email would be a
         * round trip and a rejoin for nothing, several times a minute. A joined
         * channel needs only the messages it missed — one query.
         *
         * On a phone the page was suspended and the channel is closed or
         * errored, which is the case this whole handler exists for. That one
         * gets rebuilt, and the catch-up runs when it joins.
         */
        if (mine && mine.state === 'joined') {
          void catchUp()
          return
        }
        void teardown().then(open).catch(schedule)
      }

      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisible)
      }

      void open().catch(() => {
        // A channel that cannot open is not worth a line of scrollback — but it
        // is worth another go, or the room is dead until you walk out of it.
        schedule()
      })

      return () => {
        closed = true
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', onVisible)
        }
        void teardown()
      }
    },
  }
}

/** How many missed messages are worth printing before saying "type look". */
/**
 * How many arrivals to remember by id, so a race cannot print one twice.
 *
 * Bounded because a long sitting in a busy room would otherwise grow this
 * forever; far past what one sitting in one room actually prints.
 */
const REMEMBER = 500

const CATCH_UP = 20

/** Waits between retries, in milliseconds. The last one repeats. */
const BACKOFF = [1_000, 2_000, 5_000, 15_000, 30_000] as const

/**
 * The newest thing in this room, or under this post, as the database has it.
 *
 * Null when there is nothing yet, which is not the same as "unknown" — a room
 * with no posts starts counting from its first one, and until then the
 * catch-up has nothing to compare against and correctly does nothing.
 */
async function newest(
  client: SupabaseClient,
  room: string,
  postId: number | null,
): Promise<string | null> {
  const query =
    postId === null
      ? client.from('posts').select('created_at').eq('room_slug', room)
      : client.from('replies').select('created_at').eq('post_id', postId)

  const { data } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
  // An empty room has no watermark, so start from the epoch: everything that
  // arrives from here is new, which is exactly right.
  return data?.created_at ?? new Date(0).toISOString()
}

/** Every name at once, because a catch-up is up to twenty rows. */
async function namesOf(
  client: SupabaseClient,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  const wanted = new Set<string>()

  for (const id of ids) {
    const cached = names.get(id)
    if (cached) found.set(id, cached)
    else wanted.add(id)
  }
  if (wanted.size === 0) return found

  const { data, error } = await client
    .from('profiles')
    .select('id, name')
    .in('id', [...wanted])
  if (error || !data) return found

  for (const row of data as { id: string; name: string }[]) {
    names.set(row.id, row.name)
    found.set(row.id, row.name)
  }
  return found
}

interface Row {
  /** The row's own id, which is what makes "have I printed this?" answerable. */
  id: number
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
