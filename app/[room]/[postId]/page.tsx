import { notFound } from 'next/navigation'
import { Shell } from '@/components/Shell'

/**
 * `thewall.sh/music/12` — the same address as the prompt path, which is why
 * shareable URLs fall out of the design at zero cost (§3.4).
 */
export default async function Page({
  params,
}: {
  params: Promise<{ room: string; postId: string }>
}) {
  const { room, postId } = await params

  // Post addresses are integers. Anything else was never one of ours.
  if (!/^\d+$/.test(postId)) notFound()

  return <Shell initialLocation={{ room, postId: Number(postId) }} />
}
