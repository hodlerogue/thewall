import type { SupabaseClient } from '@supabase/supabase-js'
import type { Live } from '@/lib/data/live'
import { ROOM_PAGE, type Check, type Env, type MadeRoom, type MailItem, LOBBY_FETCH } from '@/lib/shell/env'
import type { Post, PostHit, Profile, Room, RoomHit, RoomSummary, RoomList } from '@/lib/shell/model'
import { FEED_PAGE } from '@/lib/shell/render'

/**
 * The Env the commands actually run against.
 *
 * Every query here is a plain anonymous read — the policies in
 * `20260803000000_initial_schema.sql` decide what comes back. In particular
 * nothing filters for commons expiry, because the select policy already does
 * (§3.10); if that were done here instead, every future query would have to
 * remember to do it too.
 */
export function supabaseEnv(client: SupabaseClient, live?: Live): Env {
  // Named rather than returned inline, so getProfile can call searchPosts
  // instead of restating the query that decides what a person's posts are.
  const env: Env = {
    async listRooms(): Promise<RoomList> {
      /*
       * §3.11 — one round trip for the lobby, including proof of life.
       *
       * A page and a count, not the whole table. This used to select every
       * listable room: measured against a database with 310 in it, that is
       * **65 KB of JSON on every boot** to draw twelve lines, and it grows
       * without limit.
       *
       * `count: 'exact'` rides along in the same request — PostgREST returns it
       * in the Content-Range header — so the "298 more rooms" line stays true
       * without a second round trip. Deriving it from `data.length` instead
       * would report the size of the page, which is the trap a room listing
       * already fell into once: asking for N and getting N is the same answer
       * whether there is one more or four thousand.
       */
      const { data, error, count } = await client
        .from('room_overview')
        .select('slug, gloss, ephemeral, curated, latest_body, latest_at, latest_author', {
          count: 'exact',
        })
        // Curated first in their curated order, then whatever people have made,
        // liveliest first. The view has already dropped user rooms that went
        // quiet, so this is a listing of the building rather than of the
        // database (§4.2).
        .order('curated', { ascending: false })
        .order('sort_order')
        .order('latest_at', { ascending: false, nullsFirst: false })
        .limit(LOBBY_FETCH)

      if (error) throw error

      const rooms = (data ?? []).map((row) => ({
        slug: row.slug,
        gloss: row.gloss,
        ephemeral: row.ephemeral,
        curated: row.curated ?? true,
        latest:
          row.latest_body && row.latest_at
            ? {
                author: row.latest_author ?? 'someone',
                body: row.latest_body,
                createdAt: new Date(row.latest_at),
              }
            : undefined,
      }))

      /*
       * `count` is null when PostgREST cannot supply one. Falling back to the
       * page length is the only honest thing left: it makes the "more" line say
       * nothing rather than say a number that is wrong, and a room reached by
       * name still works either way.
       */
      return { rooms, total: count ?? rooms.length }
    },

    async makeRoom(slug: string, gloss: string, from?: string): Promise<MadeRoom> {
      const { data, error } = await client.rpc('create_room', {
        p_slug: slug,
        p_gloss: gloss,
        // Where the person was standing. The function checks it rather than
        // trusting it — a client is not a source of truth about anything.
        p_from: from ?? null,
      })
      // Every rule lives in the function, and every refusal arrives as a
      // sentence already written for a person to read (§3.7) — so this passes
      // it through rather than translating it into something vaguer.
      if (error) return { ok: false, reason: friendlyRoomError(error.message) }
      return { ok: true, slug: typeof data === 'string' ? data : slug }
    },

    async findRooms(term: string): Promise<RoomHit[]> {
      const { data, error } = await client.rpc('find_rooms', { p_term: term, p_limit: 20 })
      if (error) throw error

      const rows = (data ?? []) as {
        slug: string
        gloss: string
        curated: boolean
        in_lobby: boolean
        latest_at: string | null
        post_count: number
      }[]

      return rows.map((row) => ({
        slug: row.slug,
        gloss: row.gloss,
        curated: row.curated,
        inLobby: row.in_lobby,
        posts: Number(row.post_count ?? 0),
        latestAt: row.latest_at ? new Date(row.latest_at) : undefined,
      }))
    },

    async readFeed(): Promise<PostHit[]> {
      const { data, error } = await client.rpc('wall_feed', { p_limit: FEED_PAGE })
      if (error) throw error

      const rows = (data ?? []) as {
        room: string
        post_no: number
        author: string
        body: string
        created_at: string
        replies: number
      }[]

      return rows.map((row) => ({
        room: row.room,
        id: row.post_no,
        author: row.author,
        body: row.body,
        createdAt: new Date(row.created_at),
        replies: Number(row.replies ?? 0),
      }))
    },

    async getRoom(slug: string): Promise<Room | undefined> {
      const { data: room, error: roomError } = await client
        .from('rooms')
        /*
         * The owner is joined rather than read off the `~name` slug. The two
         * agree today — `change_name` renames the wall with the person — but
         * the slug is a string anyone could come to write and the column is the
         * thing the write policy actually checks.
         *
         * The constraint is named, and it has to be. `rooms` has two foreign
         * keys to `profiles` now — owner_id, whose wall it is, and created_by,
         * who opened it — and a bare `profiles(name)` is ambiguous the moment
         * the second one exists. PostgREST refuses the whole query rather than
         * guessing, so this failed on every page load: not a wrong answer, no
         * lobby at all.
         */
        .select('slug, gloss, ephemeral, owner:profiles!rooms_owner_id_fkey(name)')
        .eq('slug', slug)
        .maybeSingle()

      if (roomError) throw roomError
      if (!room) return undefined

      // One more than we intend to show. Asking for exactly a page and getting
      // a full one cannot tell "that is the whole room" from "there are nine
      // hundred more", and the difference is the entire point of `older`.
      const { data: posts, error: postsError } = await client
        .from('posts')
        .select('post_no, body, created_at, author:profiles(name), replies(count)')
        .eq('room_slug', slug)
        .order('created_at', { ascending: false })
        .limit(ROOM_PAGE + 1)

      if (postsError) throw postsError

      // Subtopics, such as they are. A second round trip rather than an embed:
      // `rooms.from_room` points at `rooms`, and a self-referencing embed is
      // the same ambiguity that took the site down when `created_by` landed.
      const { data: grew } = await client.rpc('rooms_from', { p_slug: slug })

      const page = posts ?? []
      return {
        slug: room.slug,
        gloss: room.gloss,
        ephemeral: room.ephemeral,
        owner: ownerName(room.owner),
        grewOut: ((grew ?? []) as { slug: string; gloss: string }[]).map((row) => ({
          slug: row.slug,
          gloss: row.gloss,
        })),
        more: page.length > ROOM_PAGE,
        posts: page.slice(0, ROOM_PAGE).map(toPost),
      }
    },

    async olderPosts(slug: string, beforePostNo: number): Promise<Post[]> {
      /*
       * Keyed on `post_no`, not on a row offset.
       *
       * The address is allocated by `create_post` and never reused (§3.4), so
       * it is a stable cursor: somebody posting while you read backwards adds a
       * *higher* number and cannot disturb where you are. An offset would shift
       * by one under exactly that, quietly skipping a post.
       */
      const { data, error } = await client
        .from('posts')
        .select('post_no, body, created_at, author:profiles(name), replies(count)')
        .eq('room_slug', slug)
        .lt('post_no', beforePostNo)
        .order('post_no', { ascending: false })
        .limit(ROOM_PAGE)

      if (error) throw error
      return (data ?? []).map(toPost)
    },

    async notifyState(): Promise<boolean> {
      const { data, error } = await client.rpc('notify_state')
      // A guest has no setting and no way to have one. False is the answer,
      // not a failure.
      if (error) return false
      return data === true
    },

    async setNotify(on: boolean) {
      const { error } = await client.rpc('set_notify', { p_on: on })
      /*
       * The refusal that matters here is "follow the link in your email first",
       * raised by the function when somebody unverified tries to turn it on. It
       * is already a sentence written for a person to read (§3.7), so it is
       * passed through rather than translated into something vaguer.
       */
      if (error) {
        // Already a sentence for a person; the fall-through is for anything
        // the database says that nobody has written a human version of yet.
        const said = error.message.replace(/^.*?:\s*/, '')
        return { ok: false as const, reason: said || 'couldn’t change that just now.' }
      }
      return { ok: true as const, on }
    },

    async getPost(slug: string, id: number): Promise<Post | undefined> {
      const { data, error } = await client
        .from('posts')
        .select(
          'post_no, body, created_at, author:profiles(name), replies(reply_no, to_reply_no, body, created_at, author:profiles(name))',
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
            id: reply.reply_no,
            author: authorName(reply.author),
            body: reply.body,
            createdAt: new Date(reply.created_at),
            toReply: reply.to_reply_no ?? undefined,
          }))
          /*
           * Flat and chronological. There is still no tree to sort — a reply
           * that answers another is not underneath it, it is after it, with a
           * pointer saying which one it means.
           */
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      }
    },

    async who() {
      // Who is actually here, from the channel for the room you are standing
      // in — not who has an account, and not whichever room you happened to
      // land in first, which is what this used to answer.
      return live?.present() ?? { names: [], guests: 0 }
    },

    async mailCount(): Promise<number> {
      // Zero rather than an error for a guest: reading is anonymous (§3.9),
      // and a signed-out visitor having no mail is not a failure.
      const { data, error } = await client.rpc('mail_count')
      if (error) return 0
      return typeof data === 'number' ? data : 0
    },

    async readMail(): Promise<MailItem[]> {
      const { data, error } = await client.rpc('mail')
      if (error) throw error

      const items = (data ?? []) as {
        room: string
        post_no: number
        author: string
        body: string
        created_at: string
      }[]

      // Reading is what marks them read — §4.1 is pull-only, so the act of
      // looking is the only signal there is.
      await client.rpc('mark_mail_seen')

      return items.map((row) => ({
        room: row.room,
        postId: row.post_no,
        author: row.author,
        body: row.body,
        createdAt: new Date(row.created_at),
      }))
    },

    async searchPosts(query): Promise<PostHit[]> {
      /*
       * One RPC over posts *and* replies.
       *
       * This used to read the posts table directly and therefore never found a
       * single reply — on a site whose §4.3 shape is "a post, then a flat list
       * of answers", that is most of what anybody says. It also interpolated
       * the term straight into `ilike`, so a search for "100%" was a wildcard
       * that matched everything.
       */
      const { data, error } = await client.rpc('search_said', {
        p_text: query.text ?? null,
        p_room: query.room ?? null,
        p_by: query.by ?? null,
        p_since: query.since?.toISOString() ?? null,
        p_limit: query.limit,
      })
      if (error) throw error

      const rows = (data ?? []) as {
        room: string
        post_no: number
        author: string
        body: string
        created_at: string
        is_reply: boolean
      }[]

      return rows.map((row) => ({
        room: row.room,
        id: row.post_no,
        author: row.author,
        body: row.body,
        createdAt: new Date(row.created_at),
        isReply: row.is_reply,
      }))
    },

    async diagnose(): Promise<Check[]> {
      const checks: Check[] = []

      const { data: userData } = await client.auth.getUser()
      const user = userData.user ?? null
      checks.push({
        label: 'session',
        ok: user !== null,
        note: user ? 'signed in' : 'reading as a guest',
      })

      if (user) {
        const { data: profile } = await client
          .from('profiles')
          .select('name, verified_at')
          .eq('id', user.id)
          .maybeSingle()

        checks.push({
          label: 'name',
          ok: Boolean(profile?.name),
          note: profile?.name ?? 'no profile row for this account',
        })
        checks.push({
          label: 'verified',
          ok: Boolean(profile?.verified_at),
          note: profile?.verified_at ? 'yes' : 'no — the key was never recorded',
        })
      }

      /*
       * One column per migration that adds one, probed individually so a
       * missing one names itself. Cheaper and safer than calling the functions:
       * `mark_verified` used to be callable from here, and would have marked
       * you verified as a side effect of asking whether it existed. It is
       * service-role-only now — but the reason to probe columns outlives the
       * one function that made the point.
       */
      for (const [table, column, migration] of [
        ['profiles', 'verified_at', '20260803020000_verify_to_continue'],
        ['profiles', 'mail_seen_at', '20260804010000_mail'],
        ['profiles', 'banned_at', '20260804020000_moderation'],
        ['profiles', 'name_since', '20260804030000_rename'],
        ['rooms', 'owner_id', '20260804050000_walls'],
        // `curated`, not `created_by`: the latter is deliberately not
        // readable by the browser, so probing it would report every correctly
        // migrated project as missing this one.
        ['rooms', 'curated', '20260805000000_user_rooms'],
        ['profiles', 'terms_accepted_at', '20260805010000_terms_accepted'],
      ] as const) {
        const { error } = await client.from(table).select(column).limit(1)
        checks.push({
          label: migration,
          ok: !error,
          note: error ? 'NOT APPLIED' : 'applied',
        })
      }

      return checks
    },

    async getProfile(name: string): Promise<Profile | undefined> {
      const { data, error } = await client
        .from('profiles')
        .select('name, created_at, verified_at')
        .eq('name', name.toLowerCase())
        .maybeSingle()

      if (error) throw error
      if (!data) return undefined

      // §4.6 — names are released the moment they are dropped, so one can have
      // been worn before. Told as a date and never as a person.
      const { data: changedHands } = await client.rpc('name_changed_hands', { p_name: data.name })

      return {
        name: data.name,
        joinedAt: new Date(data.created_at),
        nameChangedHands: typeof changedHands === 'string' ? new Date(changedHands) : undefined,
        // Public already: "anyone may read profiles" is what lets a name be
        // resolved at all. Showing it is what makes §4.7 legible rather than
        // a silent condition people hit without knowing why.
        verified: data.verified_at !== null,
        posts: await env.searchPosts({ by: data.name, limit: 10 }),
      }
    },
  }

  return env
}

interface RawReply {
  reply_no: number
  to_reply_no: number | null
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

/**
 * Postgres error text, kept when it was written for a person and replaced when
 * it was not.
 *
 * Every `raise` in `create_room` is already a sentence somebody can act on, so
 * the default is to pass it through untouched. The exceptions are the ones
 * Postgres itself writes — a check constraint firing, or the function being
 * absent because the migration is not applied.
 */
function friendlyRoomError(message: string): string {
  if (/Could not find the function|schema cache|PGRST202/i.test(message)) {
    return 'making rooms is not switched on here yet — the database is missing a migration. type doctor.'
  }
  if (/violates check constraint|violates unique constraint/i.test(message)) {
    return 'that name will not work. 2 to 24 characters of a-z, 0-9 and -, and not one already taken.'
  }
  return message
}

/** Same embed, but absent is the ordinary case: most rooms belong to nobody. */
function ownerName(owner: unknown): string | undefined {
  if (!owner) return undefined
  const one = (Array.isArray(owner) ? owner[0] : owner) as { name?: string } | undefined
  return one?.name ?? undefined
}

function replyCount(replies: unknown): number {
  if (Array.isArray(replies)) {
    const first = replies[0] as { count?: number } | undefined
    return first?.count ?? 0
  }
  return 0
}

/**
 * A posts row as the shell's `Post`. Shared by the first page and every page
 * `older` fetches after it, so the two cannot drift into showing different
 * things about the same post.
 */
function toPost(row: {
  post_no: number
  body: string
  created_at: string
  author: { name: string } | { name: string }[] | null
  replies: unknown
}): Post {
  return {
    id: row.post_no,
    author: authorName(row.author),
    body: row.body,
    createdAt: new Date(row.created_at),
    // The listing only needs the count; the bodies arrive when you go in.
    /*
     * The listing only needs the count; the bodies arrive when you go in. The
     * ids are 1..n rather than 0 so that nothing downstream can mistake a
     * placeholder for a real address — but nothing downstream reads them, and
     * a `renderPosts` that started to would be reading a lie either way.
     */
    replies: Array.from({ length: replyCount(row.replies) }, (_, i) => ({
      id: i + 1,
      author: '',
      body: '',
      createdAt: new Date(0),
    })),
  }
}
