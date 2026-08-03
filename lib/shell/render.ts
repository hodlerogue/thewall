import type { FixturePost, FixtureRoom } from '@/lib/shell/fixtures'
import type { Line } from '@/lib/shell/types'

/**
 * §3.2 — depth is indentation, never box drawing. Post flush, reply +1 step,
 * reply body +2. No `└─`, nothing that falls apart at 380px.
 */

/** §3.11 — the lobby shows proof of life: a busy building, not a list of doors. */
export function renderRoomList(rooms: readonly FixtureRoom[]): Line[] {
  const lines: Line[] = []
  for (const room of rooms) {
    const latest = room.posts[0]
    lines.push({ text: room.slug, tone: 'accent' })
    lines.push({
      text: latest
        ? `${truncate(latest.body, 58)} — ${latest.author}, ${latest.ago} ago`
        : 'quiet in here',
      tone: latest ? 'dim' : 'faint',
      depth: 1,
    })
  }
  return lines
}

export function renderRoom(room: FixtureRoom): Line[] {
  if (room.posts.length === 0) {
    return [{ text: 'nothing here yet. say something and it will be the first thing.', tone: 'faint' }]
  }

  const lines: Line[] = []
  if (room.ephemeral) {
    lines.push({ text: 'commons keeps nothing. everything here is gone in 24 hours.', tone: 'faint' })
    lines.push({ text: '' })
  }
  for (const post of room.posts) {
    // Post number first: it is the address, and it is permanent (§3.4).
    lines.push({
      text: room.ephemeral ? `${post.author}, ${post.ago} ago` : `${post.id}  ${post.author}, ${post.ago} ago`,
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

/** §3.2 — a post is a room. You are inside the conversation, not looking at it. */
export function renderPost(room: FixtureRoom, post: FixturePost): Line[] {
  const lines: Line[] = [
    { text: `${post.author}, ${post.ago} ago`, tone: 'dim' },
    { text: post.body },
    { text: '' },
  ]
  if (post.replies.length === 0) {
    lines.push({ text: 'no replies yet.', tone: 'faint' })
    return lines
  }
  for (const reply of post.replies) {
    lines.push({ text: `${reply.author}, ${reply.ago} ago`, tone: 'dim', depth: 1 })
    lines.push({ text: reply.body, depth: 2 })
  }
  return lines
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}
