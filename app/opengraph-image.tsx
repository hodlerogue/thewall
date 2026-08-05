import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from '@/lib/brand/og'
import { ON_THE_CARD } from '@/lib/brand/ogRooms'
import { ROOMS } from '@/lib/shell/fixtures'
import { renderRoomList } from '@/lib/shell/render'

/**
 * The card for the front door, and the fallback for everything without one.
 *
 * Three rooms with what was last said in them, because §3.11's whole point is
 * that proof of life "is the difference between a busy building and a list of
 * doors" — and a share card is the one place that difference decides whether
 * anybody clicks. Five rooms reading "quiet in here" is the §5 failure mode
 * printed at 1200×630.
 *
 * The §5 seed content rather than a live query, deliberately. This image is
 * prerendered at build time for `/`, `/lobby`, `/terms` and `/privacy`, and
 * what it has to show is what the place *is*. A live lobby would say the same
 * thing on a good day and nothing at all on the day the link gets shared.
 */

export const alt = 'thewall.social — a place you navigate by typing'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default async function Image() {
  const shown = ON_THE_CARD.map((slug) => ROOMS.find((room) => room.slug === slug)!)

  return ogCard({
    path: '',
    lines: [
      { text: 'guest:lobby$ look', tone: 'echo' },
      { text: '' },
      ...renderRoomList(
        shown.map((room) => {
          const latest = room.posts[0]
          return {
            slug: room.slug,
            gloss: room.gloss,
            ephemeral: room.ephemeral,
            // The card only ever shows named curated rooms (see ogRooms), so
            // this is a constant rather than a lookup.
            curated: true,
            latest: latest && {
              author: latest.author,
              body: latest.body,
              createdAt: latest.createdAt,
            },
          }
        }),
        new Date(),
        // The card column is 59 characters; the attribution needs the rest.
        32,
      ),
      { text: `…and ${ROOMS.length - shown.length} more rooms.`, tone: 'faint' },
    ],
  })
}
