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
  for (const post of posts) {
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
    return lines
  }

  for (const post of room.posts) {
    // The number comes first because it is the address, and it is permanent.
    lines.push({
      text: room.ephemeral
        ? `${post.author}, ${formatAgo(post.createdAt, now)}`
        : `${post.id}  ${post.author}, ${formatAgo(post.createdAt, now)}`,
      tone: 'dim',
    })
    lines.push({ text: post.body, depth: 1 })
    if (!room.ephemeral && post.replies.length > 0) {
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

  for (const post of profile.posts) {
    // The address, not the author: you already know whose page this is.
    lines.push({ text: `${post.room}/${post.id}  ${formatAgo(post.createdAt, now)}`, tone: 'dim' })
    lines.push({ text: post.body, depth: 1 })
  }

  const newest = profile.posts[0]
  lines.push({ text: '' })
  lines.push({
    // Two closing lines because there are now two kinds of address on this
    // page, and the old one — "go to the room first" — is a wrong instruction
    // for a post on their wall: you are already standing where that opens.
    text:
      newest.room === `~${profile.name}`
        ? `the ~${profile.name} ones are here — go ${newest.id} opens that one.`
        : `these live in rooms — go ${newest.room}, then go ${newest.id}.`,
    tone: 'faint',
  })
  return lines
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}
