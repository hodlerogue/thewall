import { Shell } from '@/components/Shell'
import { pathToLocation } from '@/lib/shell/types'

/**
 * `thewall.social/music` — the same place `go music` puts you (§3.4).
 *
 * The segment is parsed rather than assumed to be a room, because `~marisol`
 * arrives through this same route and is a person, not a place.
 */
export default async function Page({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params
  return <Shell initialLocation={pathToLocation(`/${room}`)} />
}
