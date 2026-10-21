import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Readable } from '@/components/Readable'
import { Shell } from '@/components/Shell'
import { personIsMissing, roomIsMissing } from '@/lib/brand/ogData'
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

  /*
   * A real 404 for a room or person that is not there.
   *
   * QA: `/nope404` answered 200 with a blank page, so to a search engine every
   * typo was a page, and to a person it was nothing at all. Only when the
   * database said "no such thing" — a failed read still gets the prompt, which
   * explains itself, rather than a 404 for a room that may well exist. Checked
   * here, before anything renders, because once the page starts streaming the
   * status is already sent.
   */
  const missing =
    location.person !== undefined
      ? await personIsMissing(location.person)
      : location.room === undefined || (await roomIsMissing(location.room))
  if (missing) notFound()

  return (
    <Shell initialLocation={location}>
      <Readable at={location} />
    </Shell>
  )
}
