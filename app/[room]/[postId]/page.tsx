import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Readable } from '@/components/Readable'
import { Shell } from '@/components/Shell'
import { postMetadata } from '@/lib/seo/pages'
import { pathToLocation } from '@/lib/shell/types'

/**
 * The post's own first line, as the title — the same slice a room listing
 * shows, and the closest thing a post has to a subject (see `write`).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ room: string; postId: string }>
}): Promise<Metadata> {
  const { room, postId } = await params
  const location = pathToLocation(`/${room}/${postId}`)
  return location.postId === undefined ? {} : postMetadata(location)
}

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

  return (
    <Shell initialLocation={location}>
      <Readable at={location} />
    </Shell>
  )
}
