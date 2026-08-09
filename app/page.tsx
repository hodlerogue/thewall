import { redirect } from 'next/navigation'
import { FRONT_DOOR } from '@/lib/shell/types'

/**
 * The front door.
 *
 * §3.10 — you start in commons. It is a peer room rather than special
 * structure, so the front door simply puts you in it; the lobby has its own
 * address at /lobby and stays a pure directory, one `leave` away.
 *
 * The query string is carried across, which it was not. A redirect that drops
 * it makes this door lossy, and the first thing to fall through was the magic
 * link: `/auth/callback` sends people to `/` with the outcome of their key
 * attached, and every one of them arrived at `/commons` with it gone — so a key
 * that worked and a key that failed both landed in silence.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') params.set(key, value)
    else if (Array.isArray(value)) for (const one of value) params.append(key, one)
  }

  /*
   * A crawler follows this and never sees `/`, so the share card for the bare
   * domain is whatever card the destination has — see that room's
   * `opengraph-image`, which is why it is the fixed one.
   */
  const query = params.toString()
  redirect(query ? `/${FRONT_DOOR}?${query}` : `/${FRONT_DOOR}`)
}
