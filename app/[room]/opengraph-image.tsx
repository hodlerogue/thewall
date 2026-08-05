import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from '@/lib/brand/og'
import { ogEnv } from '@/lib/brand/ogData'
import { renderFeed, renderRoom } from '@/lib/shell/render'

/**
 * `thewall.social/music` — the link somebody sends as an invitation.
 *
 * A room is the more likely share of the two, because it is what you send to
 * ask somebody to come. So it shows what is being said in there, which is the
 * only argument for turning up (§3.11).
 *
 * `~marisol` arrives through this same route and gets the same card, because a
 * wall is a room with an owner — the gloss it was created with says whose it is
 * ("what marisol is saying"), so the preview reads correctly with no special
 * case. Anything that is not a room at all still falls through to the generic
 * card rather than pretending.
 */

export const alt = 'a room on thewall.social'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default async function Image({ params }: { params: Promise<{ room: string }> }) {
  const { room: slug } = await params

  /*
   * `feed` holds nothing of its own, so the ordinary path draws a card saying
   * the room is empty — the same bug the URL had, on the surface where it is
   * seen by people who have not arrived yet. It is a listing of walls, so the
   * card is one too.
   */
  if (slug === 'feed') {
    const posts = await readFeed()
    return ogCard({
      path: '/feed',
      lines:
        posts.length === 0
          ? [{ text: 'what people are saying on their own walls', tone: 'faint' }]
          : [
              { text: 'what people are saying on their own walls', tone: 'faint' },
              { text: '' },
              ...renderFeed(posts),
            ],
    })
  }

  const room = await readRoom(slug)

  if (!room) {
    return ogCard({
      path: '',
      lines: [
        { text: 'guest:lobby$ look', tone: 'echo' },
        { text: '' },
        { text: 'six rooms, and a prompt.', tone: 'faint' },
      ],
    })
  }

  return ogCard({
    path: `/${room.slug}`,
    lines: [{ text: room.gloss, tone: 'faint' }, { text: '' }, ...renderRoom(room)],
  })
}

async function readFeed() {
  try {
    const env = ogEnv()
    return (await env?.readFeed()) ?? []
  } catch {
    return []
  }
}

async function readRoom(slug: string) {
  // A card that throws is a link with no preview, which is the state this
  // exists to fix — so every failure lands on the generic card instead.
  try {
    const env = ogEnv()
    return await env?.getRoom(slug)
  } catch {
    return undefined
  }
}
