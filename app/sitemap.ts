import type { MetadataRoute } from 'next'
import { ogEnv } from '@/lib/brand/ogData'

/**
 * How anything here gets found at all.
 *
 * Measured against the built site: `/` and `/lobby` contain **zero** `<a href>`
 * elements. That is not an oversight, it is the product — navigation is a
 * command prompt, so there is no link graph, and a crawler that lands on the
 * front door has nowhere to go. Server-rendering every room would have changed
 * nothing about discovery on its own.
 *
 * So this is the link graph, kept somewhere a crawler expects to find one.
 *
 * Rooms and their newest posts rather than everything: a sitemap is a set of
 * suggestions with a documented 50,000-URL ceiling, and the point is that the
 * live parts of the site are reachable, not that every address is enumerated.
 * Anything not listed is still crawlable — nothing here is `noindex`.
 */

/** Recrawled hourly at most. The lobby moves; the policies do not. */
export const revalidate = 3600

/**
 * How many posts to name, across all rooms.
 *
 * Bounded because this is one query at request time and a sitemap that takes
 * four seconds to build is a sitemap that times out. The newest are the ones
 * worth crawling first, and a crawler that follows them finds the room, which
 * lists more.
 */
const POSTS = 500

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://thewall.social'
  const at = (path: string) => `${site.replace(/\/$/, '')}${path}`

  /*
   * The pages that exist whether or not a database answers.
   *
   * `/hello` and `/about` are weighted highest, and they are the two halves of
   * the same job: the first is the four-second version with a working demo of
   * the prompt in it, the second is the rundown that explains what a command
   * prompt is doing on a social site. Between them they are the answer to every
   * query that could plausibly bring somebody here cold.
   */
  const always: MetadataRoute.Sitemap = [
    { url: at('/'), changeFrequency: 'hourly', priority: 1 },
    { url: at('/hello'), changeFrequency: 'monthly', priority: 0.9 },
    { url: at('/about'), changeFrequency: 'monthly', priority: 0.9 },
    { url: at('/lobby'), changeFrequency: 'hourly', priority: 0.8 },
    { url: at('/terms'), changeFrequency: 'yearly', priority: 0.1 },
    { url: at('/privacy'), changeFrequency: 'yearly', priority: 0.1 },
  ]

  const env = ogEnv()
  if (!env) return always

  try {
    const { rooms } = await env.listRooms()
    const listable = rooms.filter((room) => !room.ephemeral)

    /*
     * commons is left out on purpose, and it is the only exclusion here.
     *
     * Everything said there is gone in 24 hours (§3.10), and a crawler is
     * invited back on a schedule measured in days — so every visit would find a
     * different room, none of it the room that was indexed. Pointing a crawler
     * at content designed to be gone is how a site earns a reputation for thin
     * pages.
     */
    const roomUrls: MetadataRoute.Sitemap = listable.map((room) => ({
      url: at(`/${room.slug}`),
      lastModified: room.latest?.createdAt,
      changeFrequency: 'daily',
      priority: 0.7,
    }))

    // Newest first, and only what is kept: `searchPosts` already skips
    // ephemeral rooms, so commons cannot arrive through this door either.
    const posts = await env.searchPosts({ limit: POSTS })
    const postUrls: MetadataRoute.Sitemap = posts.map((post) => ({
      url: at(`/${post.room}/${post.id}`),
      lastModified: post.createdAt,
      changeFrequency: 'weekly',
      priority: 0.6,
    }))

    return [...always, ...roomUrls, ...postUrls]
  } catch {
    // A sitemap that 500s is worse than a short one: a crawler that gets an
    // error backs off, and the five pages above are the ones that matter most.
    return always
  }
}
