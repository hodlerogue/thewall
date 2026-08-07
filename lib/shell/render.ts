import {
  formatAgo,
  type Post,
  type PostHit,
  type Profile,
  type Room,
  type RoomSummary,
} from '@/lib/shell/model'
import type { Line } from '@/lib/shell/types'

/**
 * §3.2 — depth is indentation, never box drawing. Post flush, reply +1 step,
 * reply body +2. No `└─`, nothing that falls apart at 380px.
 */

/**
 * Time runs down the screen, once.
 *
 * Every query here asks for the newest N — `order by created_at desc limit 30`
 * — and that is right, because the newest N is what you want. It was then also
 * *printed* in that order, and that was wrong, for a reason particular to a
 * scrollback rather than a page.
 *
 * A page starts at the top, so newest-first puts the newest thing where the eye
 * lands. This does the opposite: `Terminal` sets `scrollTop = scrollHeight`
 * after every command, so the view lands on the **end** of what was printed.
 * Printing newest-first therefore filled the screen with the oldest posts in
 * the room and scrolled the newest ones off the top — the exact opposite of
 * what asking for the newest thirty was for.
 *
 * It also ran time in two directions at once. Your commands and their output
 * accumulate downward, so the scrollback is already oldest-at-top; a room whose
 * posts ran the other way meant scrolling up moved forward in time inside one
 * block and backward between blocks.
 *
 * So: fetch newest-first, print oldest-first. The newest thing ends up directly
 * above the prompt, which is both where you are looking and what you are most
 * likely to answer.
 */
function oldestFirst<T>(items: readonly T[]): T[] {
  return [...items].reverse()
}

/**
 * §3.11 — proof of life: the difference between a busy building and a list of
 * doors. And §4.2's mitigation, now that anybody can add a door.
 *
 * The cap is the whole of it. "40 rooms with three people each kills the entire
 * feeling" is a claim about this list and nothing else, so the list is what is
 * bounded: the curated rooms, then the liveliest of whatever people have made,
 * and a line saying how to reach the rest. Everything stays addressable — this
 * hides nothing, it just refuses to make the front page a directory.
 */
export const LOBBY_LIMIT = 12

export function renderRoomList(
  rooms: readonly RoomSummary[],
  now = new Date(),
  /** How much of the latest post to show. Narrower on a share card (1200px). */
  bodyWidth = 56,
  limit = LOBBY_LIMIT,
): Line[] {
  const lines: Line[] = []

  // Curated rooms are never the ones dropped. They are the furniture: the
  // building has to look the same each time you walk in, or none of §3.11's
  // argument about it reading as a place survives.
  const curated = rooms.filter((room) => room.curated)
  const made = rooms.filter((room) => !room.curated)
  const shown = [...curated, ...made.slice(0, Math.max(0, limit - curated.length))]

  for (const room of shown) {
    lines.push({ text: room.slug, tone: 'accent' })
    lines.push({
      text: room.latest
        ? `${truncate(room.latest.body, bodyWidth)} — ${room.latest.author}, ${formatAgo(room.latest.createdAt, now)}`
        : 'quiet in here',
      tone: room.latest ? 'dim' : 'faint',
      depth: 1,
    })
  }

  const hidden = rooms.length - shown.length
  if (hidden > 0) {
    lines.push({ text: '' })
    lines.push({
      text: `${hidden} more ${hidden === 1 ? 'room' : 'rooms'} — find --rooms <word>, or go straight to one by name.`,
      tone: 'faint',
    })
  }
  return lines
}

/**
 * The feed: everything on everybody's walls, newest first.
 *
 * Rendered like search hits rather than like a room, because that is what it
 * is. A room listing puts a bare number in front of each post, and a bare
 * number is meaningless here — `2` is a different post on every wall. The
 * address carries the name, which is also what `go` wants back.
 */
export function renderFeed(posts: readonly PostHit[], now = new Date()): Line[] {
  if (posts.length === 0) {
    return [
      { text: 'nothing on anybody’s wall yet.', tone: 'faint' },
      { text: 'go ~yourname and say something, and it shows up here.', tone: 'faint' },
    ]
  }

  const lines: Line[] = []
  for (const post of oldestFirst(posts)) {
    lines.push({
      text: `${post.room}/${post.id}  ${post.author}, ${formatAgo(post.createdAt, now)}`,
      tone: 'dim',
    })
    lines.push({ text: post.body, depth: 1 })
    if (post.replies) {
      lines.push({
        text: `${post.replies} ${post.replies === 1 ? 'reply' : 'replies'} — go ${post.room}/${post.id}`,
        tone: 'faint',
        depth: 1,
      })
    }
    lines.push({ text: '' })
  }
  lines.push({
    text: 'anybody can answer any of these. say something here and it goes on your own wall.',
    tone: 'faint',
  })
  return lines
}

export function renderRoom(room: Room, now = new Date()): Line[] {
  const lines: Line[] = []

  if (room.ephemeral) {
    lines.push({ text: 'commons keeps nothing. everything here is gone in 24 hours.', tone: 'faint' })
    lines.push({ text: '' })
  }

  if (room.posts.length === 0) {
    lines.push({
      text: 'nothing here yet. say something and it will be the first thing.',
      tone: 'faint',
    })
    // Still listed. This branch returned early, which would have hidden the
    // subtopics of exactly the room most likely to have them — an empty one
    // that people walked out of into something more specific.
    lines.push(...renderGrewOut(room))
    return lines
  }

  /*
   * No silent caps — the rule this listing was the last place to break.
   *
   * `mail` says "these are the newest 100" and the lobby says "4 more rooms".
   * A room said nothing at all: it showed a page and stopped on a blank line,
   * indistinguishable from the whole room, with no way to reach the rest. That
   * is the site's own claim — "when you have read it you have read it" — being
   * quietly false in every busy room.
   *
   * At the top, because that is where the cut is: the listing runs oldest-first
   * now, so everything missing is older than the first line under this.
   */
  if (room.more) {
    lines.push({ text: 'older — the page before this one.', tone: 'faint' })
    lines.push({ text: '' })
  }

  lines.push(...renderPosts(room.posts, room.ephemeral, now))
  lines.push(...renderGrewOut(room))
  return lines
}

/**
 * Subtopics, without a tree.
 *
 * Nesting was asked for and argued down — see the migration — so a room that
 * grew out of this one is an ordinary room with an ordinary address, and this
 * line is the only thing connecting them. It sits at the bottom because that is
 * where the eye lands, and because it is navigation rather than content: read
 * the room, then see where else it went.
 */
const GREW_OUT_LIMIT = 8

function renderGrewOut(room: Room): Line[] {
  const grew = room.grewOut ?? []
  if (grew.length === 0) return []

  const lines: Line[] = [{ text: '' }]
  const shown = grew.slice(0, GREW_OUT_LIMIT)

  lines.push({
    text: `${grew.length === 1 ? 'a room' : 'rooms'} that grew out of here:`,
    tone: 'faint',
  })
  for (const child of shown) {
    lines.push({ text: `${child.slug} — ${child.gloss}`, tone: 'dim', depth: 1 })
  }

  // No silent caps, here as everywhere. A room that spawned forty is not going
  // to list forty on a 380px screen, and the ones cut off are still findable.
  if (grew.length > shown.length) {
    lines.push({
      text: `and ${grew.length - shown.length} more — find --rooms <word> reaches them.`,
      tone: 'faint',
      depth: 1,
    })
  }
  return lines
}

/**
 * The posts themselves, shared by a room listing and by `older`.
 *
 * Extracted rather than duplicated: a second copy of this loop is a second
 * place to forget the reply count, the ephemeral branch, or which way round
 * time runs — and `older` prints into the same scrollback, directly under a
 * block produced by the other one.
 */
export function renderPosts(
  posts: readonly Post[],
  ephemeral: boolean,
  now = new Date(),
): Line[] {
  const lines: Line[] = []
  for (const post of oldestFirst(posts)) {
    // The number comes first because it is the address, and it is permanent.
    lines.push({
      text: ephemeral
        ? `${post.author}, ${formatAgo(post.createdAt, now)}`
        : `${post.id}  ${post.author}, ${formatAgo(post.createdAt, now)}`,
      tone: 'dim',
    })
    lines.push({ text: post.body, depth: 1 })
    if (!ephemeral && post.replies.length > 0) {
      lines.push({
        text: `${post.replies.length} ${post.replies.length === 1 ? 'reply' : 'replies'} — go ${post.id}`,
        tone: 'faint',
        depth: 1,
      })
    }
    lines.push({ text: '' })
  }
  return lines
}

/** §3.2 — a post is a room: you are inside the conversation, not looking at it. */
export function renderPost(post: Post, now = new Date()): Line[] {
  const lines: Line[] = [
    { text: `${post.author}, ${formatAgo(post.createdAt, now)}`, tone: 'dim' },
    { text: post.body },
    { text: '' },
  ]

  if (post.replies.length === 0) {
    lines.push({ text: 'no replies yet. say something to be the first.', tone: 'faint' })
    return lines
  }

  for (const reply of post.replies) {
    lines.push({ text: `${reply.author}, ${formatAgo(reply.createdAt, now)}`, tone: 'dim', depth: 1 })
    lines.push({ text: reply.body, depth: 2 })
  }
  return lines
}

/**
 * A person: what they have said, wherever they said it.
 *
 * Every post keeps the `room/id` it actually lives at, so the page stays a set
 * of doors — some opening back into rooms, some onto their own wall, which is
 * a room they own. Commons is absent by construction: `searchPosts` skips
 * ephemeral rooms, so nothing without a permanent address can appear here.
 */
export function renderProfile(profile: Profile, now = new Date()): Line[] {
  const lines: Line[] = [
    { text: profile.name, tone: 'accent' },
    {
      text: `arrived ${formatAgo(profile.joinedAt, now)} — ${
        profile.verified ? 'verified' : 'no key followed yet'
      }`,
      tone: 'faint',
      depth: 1,
    },
  ]

  // Accent, not faint. Everything else on this page is description; this is the
  // one line that changes how you should read the rest of it, and quiet is the
  // wrong volume for "this may not be who you think".
  if (profile.nameChangedHands) {
    lines.push({
      text: `this name was somebody else’s until ${formatAgo(profile.nameChangedHands, now)}.`,
      tone: 'accent',
      depth: 1,
    })
  }

  lines.push({ text: '' })

  if (profile.posts.length === 0) {
    lines.push({ text: 'nothing kept under this name yet.', tone: 'faint' })
    return lines
  }

  for (const post of oldestFirst(profile.posts)) {
    /*
     * The address, not the author: you already know whose page this is. But
     * "(reply)" is not optional, and leaving it off was a real regression.
     *
     * A profile lists what somebody has said, and once search learned to cover
     * replies this started including them — rendered identically to posts. So
     * marisol's page showed `music/12` above her answer to jameson's post, as
     * though the post were hers; following that address lands on his. `find`
     * grew the marker at the time and this did not.
     */
    lines.push({
      text: `${post.room}/${post.id}  ${formatAgo(post.createdAt, now)}${post.isReply ? '  (reply)' : ''}`,
      tone: 'dim',
    })
    lines.push({ text: post.body, depth: 1 })
  }

  /*
   * One instruction, and it is true of every line above it.
   *
   * This used to give a two-step recipe built from a single post: "these live
   * in rooms — go poker, then go 4". Somebody who has posted in music and poker
   * reads that as general advice, and it is only ever right for whichever post
   * happens to be newest. Reported exactly that way: "that's true for the most
   * recent post but not for any of the others, so it's just confusing."
   *
   * A whole address works from anywhere — `go` has taken them for a while — so
   * the one-step form needs no branch, applies to every line, and collapses the
   * wall case and the room case into the same sentence. The newest is used as
   * the example because it is the one directly above.
   */
  const newest = profile.posts[0]
  lines.push({ text: '' })
  lines.push({
    text: `each of those is an address — go ${newest.room}/${newest.id} opens that one.`,
    tone: 'faint',
  })
  return lines
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}
