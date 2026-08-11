import type { Metadata } from 'next'
import { ogEnv } from '@/lib/brand/ogData'
import type { Post, Room } from '@/lib/shell/model'
import type { Location } from '@/lib/shell/types'

/**
 * What a search engine is told about a room and a post.
 *
 * Every URL on this site returned the same two facts — `thewall.social`, and
 * "a place you navigate by typing" — because the only `metadata` export was the
 * one in the root layout. Measured against the built site: `/music` and
 * `/music/12` came back with an identical title, an identical description, and
 * two words of body text. Three hundred rooms indistinguishable to a crawler is
 * not a ranking problem, it is a deduplication one.
 *
 * Read through `ogEnv`, which is the same server-side, session-less, anonymous
 * reader the share cards use — so a demo deploy describes its fixtures and a
 * project that cannot answer describes nothing rather than inventing a room.
 *
 * **Every path here has to produce a page.** A title that throws is a 500 for a
 * crawler, and a crawler that gets a 500 tries less often. The share cards
 * learned this the same way: everything falls back rather than failing.
 */

/** The site's own name, appended once so a tab and a result read the same. */
const SITE = 'thewall.social'

/**
 * How much of a body a description may borrow.
 *
 * Google shows about 155 characters and truncates the rest mid-word; there is
 * no value in sending more, and real value in the cut landing on a word.
 */
const DESCRIPTION = 155

export function describe(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= DESCRIPTION) return flat

  const cut = flat.slice(0, DESCRIPTION)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > DESCRIPTION - 24 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * The canonical address of a place, which is the path the prompt shows (§3.4).
 *
 * Relative, because `metadataBase` in the root layout makes it absolute — and
 * building it by hand from an environment variable is how the share cards once
 * shipped links to a deploy preview.
 */
function canonical(path: string): Metadata['alternates'] {
  return { canonical: path }
}

async function read<T>(fetch: (env: NonNullable<ReturnType<typeof ogEnv>>) => Promise<T>) {
  try {
    const env = ogEnv()
    return env ? await fetch(env) : undefined
  } catch {
    return undefined
  }
}

/** A room, or somebody's wall, or the feed. */
export async function roomMetadata(slug: string): Promise<Metadata> {
  const room = await read((env) => env.getRoom(slug))

  if (!room) {
    // Still a real page with a real title: the room may exist and the read may
    // have failed, and either way a crawler is here now.
    return { title: `${slug} — ${SITE}`, alternates: canonical(`/${slug}`) }
  }

  return {
    title: `${room.slug} — ${SITE}`,
    description: describe(roomDescription(room)),
    alternates: canonical(`/${room.slug}`),
  }
}

function roomDescription(room: Room): string {
  const newest = room.posts[0]
  // The gloss says what the room is for; the newest post is the proof that
  // anybody is in it (§3.11), which is the half that decides whether the
  // result is worth clicking.
  return newest ? `${room.gloss}. ${newest.author}: ${newest.body}` : room.gloss
}

/** One post and its replies. */
export async function postMetadata(location: Location): Promise<Metadata> {
  const path = `/${location.room}/${location.postId}`
  const post = await read((env) => env.getPost(location.room!, location.postId!))

  if (!post) return { title: `${SITE}${path}`, alternates: canonical(path) }

  /*
   * The first line of the body, which is the subject when there is one.
   *
   * Nothing in the schema says a post has a title, and `write` deliberately did
   * not add one — somebody who writes a short opening line and their argument
   * underneath has written a subject, and it falls out of being able to type a
   * line break at all. The same slice a room listing shows.
   */
  const first = post.body.split('\n')[0]
  return {
    title: `${describe(first).slice(0, 70)} — ${location.room} — ${SITE}`,
    description: describe(post.body),
    alternates: canonical(path),
  }
}

/** Somebody's page. */
export async function personMetadata(name: string): Promise<Metadata> {
  const profile = await read((env) => env.getProfile(name))
  const path = `/~${name}`

  if (!profile) return { title: `~${name} — ${SITE}`, alternates: canonical(path) }
  return {
    title: `~${profile.name} — ${SITE}`,
    description: describe(
      profile.posts[0]
        ? `what ${profile.name} has been saying. ${profile.posts[0].body}`
        : `${profile.name} on ${SITE}.`,
    ),
    alternates: canonical(`/~${profile.name}`),
  }
}

/** Exported for the tests, which check the shape rather than the prose. */
export type { Post, Room }
