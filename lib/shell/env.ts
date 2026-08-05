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
import type {
  Post,
  PostHit,
  PostQuery,
  Profile,
  Room,
  RoomHit,
  RoomSummary,
} from '@/lib/shell/model'

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

/** What `make` did, or why it could not. */
export type MadeRoom = { ok: true; slug: string } | { ok: false; reason: string }

export interface Env {
  listRooms(): Promise<RoomSummary[]>
  /**
   * §4.2, reopened — anybody verified may make a room, three a week.
   *
   * Every rule about who may and how often lives in `create_room`, not here:
   * this reports what the database decided. A refusal is a `reason` rather than
   * a throw because "you have made three this week" is an answer, not a fault.
   */
  makeRoom(slug: string, gloss: string): Promise<MadeRoom>
  /**
   * Rooms by name or by what they are for.
   *
   * Once rooms are something people make, the lobby stops being the answer to
   * "what is here" — and a room nobody can find is a room that dies. Faded
   * rooms are included on purpose: this is the way back to one.
   */
  findRooms(term: string): Promise<RoomHit[]>
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

/** Somebody the fixtures know about. Mutable in demo mode — see `fixtureEnv`. */
export type FixturePerson = {
  name: string
  joinedAt: Date
  verified: boolean
  nameChangedHands?: Date
}

/**
 * In-memory Env over the §5 seed content, for tests and the mobile gate.
 *
 * `people` is read at call time rather than copied, so the demo can hand in an
 * array it pushes to. Without that, somebody who signs up in fixtures mode has
 * no page of their own — and their own page is the only place a wall can be
 * tried at all.
 */
/** Mirrors `reserved_slugs` in the schema — every one a real path under app/. */
const RESERVED_SLUGS = new Map([
  ['lobby', 'the lobby lives there'],
  ['api', 'that is a route'],
  ['auth', 'that is a route'],
  ['legal', 'that is a route'],
  ['terms', 'that is a route'],
  ['privacy', 'that is a route'],
  ['icon', 'that is a route'],
  ['apple-icon', 'that is a route'],
  ['opengraph-image', 'that is a route'],
])

/** §4.2's fade, matching the interval in the lobby query. */
const FADE_MS = 14 * 24 * 60 * 60 * 1000

export function fixtureEnv(
  rooms: Room[] = ROOMS,
  people: readonly FixturePerson[] = PEOPLE,
): Env {
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
      // Walls are rooms everywhere except here (§4.2). The real Env gets this
      // for free — `room_overview` filters on `owner_id is null` — and this
      // mirrors it so the lobby reads the same against fixtures.
      return rooms.filter((room) => room.owner === undefined).map((room) => {
        const latest = visiblePosts(room)[0]
        return {
          slug: room.slug,
          gloss: room.gloss,
          ephemeral: room.ephemeral,
          curated: room.madeBy === undefined,
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

    async makeRoom(slug, gloss) {
      const clean = slug.trim().toLowerCase()
      if (rooms.some((room) => room.slug === clean)) {
        return { ok: false, reason: `${clean} already exists. try: go ${clean}` }
      }
      // Mirrors `reserved_slugs`. Without it the demo would happily make a room
      // the real site refuses, which is the direction a fixture must never lie
      // in: somebody tries it here, it works, and then it does not.
      const reserved = RESERVED_SLUGS.get(clean)
      if (reserved) return { ok: false, reason: `${clean} is spoken for — ${reserved}.` }
      // Somebody's name is not available as a room — §4.6's impersonation
      // argument is about the reader, and a room in the lobby wearing a
      // person's name is aimed squarely at them.
      if (people.some((person) => person.name === clean)) {
        return { ok: false, reason: `${clean} is somebody's name. try: go ~${clean} to see them.` }
      }
      if (!/^[a-z0-9-]{2,24}$/.test(clean)) {
        return {
          ok: false,
          reason: 'a room name is 2 to 24 characters of a-z, 0-9 and -. nothing else, and no spaces.',
        }
      }
      if (gloss.trim().length < 3) {
        return {
          ok: false,
          reason: 'say what it is for, in a few words — that is the line under the name in the lobby.',
        }
      }
      // Pushed onto the same array the rest of this Env reads, so the demo can
      // make a room and then walk into it. Nothing is stored anywhere.
      rooms.push({
        slug: clean,
        gloss: gloss.trim(),
        ephemeral: false,
        madeBy: 'you',
        posts: [],
      })
      return { ok: true, slug: clean }
    },

    async findRooms(term) {
      const needle = term.trim().toLowerCase()
      return rooms
        .filter((room) => room.owner === undefined)
        .filter(
          (room) =>
            needle === '' ||
            room.slug.toLowerCase().includes(needle) ||
            room.gloss.toLowerCase().includes(needle),
        )
        .map((room) => {
          const posts = visiblePosts(room)
          const newest = posts[0]?.createdAt
          return {
            slug: room.slug,
            gloss: room.gloss,
            curated: room.madeBy === undefined,
            // The same fortnight the lobby query uses. Hard-coded `true` here
            // meant the "quiet, so it's not in the lobby" line could never be
            // reached against fixtures, and therefore never seen by a test.
            inLobby:
              room.madeBy === undefined ||
              (newest !== undefined && Date.now() - newest.getTime() < FADE_MS),
            posts: posts.length,
            latestAt: newest,
          }
        })
        .sort((a, b) => Number(b.curated) - Number(a.curated))
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
          room.posts.flatMap((post) => [
            {
              room: room.slug,
              id: post.id,
              author: post.author,
              body: post.body,
              createdAt: post.createdAt,
              isReply: false,
            },
            /*
             * Replies too, and this is not decoration. The e2e suite runs
             * entirely against this Env, so anything it gets wrong is a green
             * suite over a broken site — and `search_said` covering replies
             * while this did not would have made "find reaches replies" a claim
             * proved only in the database suite and false in the app.
             *
             * The address is the post's, because a reply has none of its own
             * (§4.3), which is exactly what the real one returns.
             */
            ...post.replies.map((reply) => ({
              room: room.slug,
              id: post.id,
              author: reply.author,
              body: reply.body,
              createdAt: reply.createdAt,
              isReply: true,
            })),
          ]),
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
      const person = people.find((p) => p.name === name.toLowerCase())
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
