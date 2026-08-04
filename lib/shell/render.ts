import { formatAgo, type Post, type Profile, type Room, type RoomSummary } from '@/lib/shell/model'
import type { Line } from '@/lib/shell/types'

/**
 * §3.2 — depth is indentation, never box drawing. Post flush, reply +1 step,
 * reply body +2. No `└─`, nothing that falls apart at 380px.
 */

/** §3.11 — proof of life: the difference between a busy building and a list of doors. */
export function renderRoomList(
  rooms: readonly RoomSummary[],
  now = new Date(),
  /** How much of the latest post to show. Narrower on a share card (1200px). */
  bodyWidth = 56,
): Line[] {
  const lines: Line[] = []
  for (const room of rooms) {
    lines.push({ text: room.slug, tone: 'accent' })
    lines.push({
      text: room.latest
        ? `${truncate(room.latest.body, bodyWidth)} — ${room.latest.author}, ${formatAgo(room.latest.createdAt, now)}`
        : 'quiet in here',
      tone: room.latest ? 'dim' : 'faint',
      depth: 1,
    })
  }
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
 * §3.10 — a person, drawn as a set of doors rather than a wall.
 *
 * Every post keeps the `room/id` it actually lives at, and the closing line is
 * a route into a room, because the one thing this view must never become is
 * somewhere to stand. Commons is absent by construction: `searchPosts` skips
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
    text: `these live in rooms — go ${newest.room}, then go ${newest.id}.`,
    tone: 'faint',
  })
  return lines
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}
