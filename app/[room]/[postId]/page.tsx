import { notFound } from 'next/navigation'
import { Shell } from '@/components/Shell'
import { pathToLocation } from '@/lib/shell/types'

/**
 * `thewall.social/music/12` — the same address as the prompt path, which is why
 * shareable URLs fall out of the design at zero cost (§3.4).
 *
 * `~marisol/2` arrives here too: a wall is a room, so it needs no route of its
 * own. Parsed rather than assembled, so one function decides what an address
 * means for the URL bar and the prompt alike.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ room: string; postId: string }>
}) {
  const { room, postId } = await params

  // Post addresses are integers. Anything else was never one of ours.
  if (!/^\d+$/.test(postId)) notFound()

  const location = pathToLocation(`/${room}/${postId}`)
  if (location.postId === undefined) notFound()

  return <Shell initialLocation={location} />
}
