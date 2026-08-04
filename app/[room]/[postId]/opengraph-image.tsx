import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from '@/lib/brand/og'
import { ogEnv } from '@/lib/brand/ogData'
import { renderPost } from '@/lib/shell/render'

/**
 * `thewall.social/music/12`, as it looks when somebody pastes it.
 *
 * This is the one §3.4 is actually about — "shareable URLs fall out of the
 * design at zero cost" is true of the address and not of the preview, and a
 * link to a conversation that previews as a domain name is a link nobody opens.
 *
 * It reads through the same `renderPost` the shell does, so the card cannot
 * show a post differently from the page it links to.
 */

export const alt = 'a post on thewall.social'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default async function Image({
  params,
}: {
  params: Promise<{ room: string; postId: string }>
}) {
  const { room, postId } = await params
  const path = `/${room}/${postId}`

  // Anything at all going wrong here still has to produce an image: a share
  // card that 500s is a link with no preview, which is the state this exists to
  // fix. So a missing project, an unapplied schema, a deleted post and a
  // profile URL that never was a post all land on the same honest fallback.
  const post = await readPost(room, Number(postId))

  if (!post) {
    return ogCard({
      path,
      lines: [{ text: 'nothing here — this post may have gone.', tone: 'faint' }],
    })
  }

  return ogCard({ path, lines: renderPost(post) })
}

async function readPost(room: string, postId: number) {
  if (!Number.isInteger(postId)) return undefined
  try {
    const env = ogEnv()
    return await env?.getPost(room, postId)
  } catch {
    return undefined
  }
}
