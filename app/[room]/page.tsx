import type { Metadata } from 'next'
import { Readable } from '@/components/Readable'
import { Shell } from '@/components/Shell'
import { personMetadata, roomMetadata } from '@/lib/seo/pages'
import { pathToLocation } from '@/lib/shell/types'

/**
 * What a search engine is told this page is.
 *
 * Without it every room inherited the root layout's title, so `/music` and
 * `/poker` and three hundred others were `thewall.social` with the same
 * description — indistinguishable, and deduplicated accordingly.
 *
 * `~marisol` arrives through this route too and is a person rather than a
 * place, so the address is parsed here exactly as it is for rendering.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ room: string }>
}): Promise<Metadata> {
  const { room } = await params
  const location = pathToLocation(`/${room}`)
  return location.person ? personMetadata(location.person) : roomMetadata(room)
}

/**
 * `thewall.social/music` — the same place `go music` puts you (§3.4).
 *
 * The segment is parsed rather than assumed to be a room, because `~marisol`
 * arrives through this same route and is a person, not a place.
 */
export default async function Page({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params
  const location = pathToLocation(`/${room}`)
  return (
    <Shell initialLocation={location}>
      <Readable at={location} />
    </Shell>
  )
}
