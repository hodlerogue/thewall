import { cache } from 'react'
import { supabaseEnv } from '@/lib/data/supabaseEnv'
import { fixtureEnv, type Env } from '@/lib/shell/env'
import { createReaderClient } from '@/lib/supabase/reader'

/**
 * Where a share card reads from.
 *
 * The same rule the shell follows in `Shell.tsx`, and for the same reason: a
 * demo deploy serves fixtures everywhere, so a card that reached past them
 * would advertise content that deployment does not have. There is no silent
 * fallback in the other direction — a configured project that fails to answer
 * gets the generic card, never invented posts.
 */
export function ogEnv(): Env | null {
  if (process.env.NEXT_PUBLIC_USE_FIXTURES === '1') return fixtureEnv()
  const client = createReaderClient()
  return client ? supabaseEnv(client) : null
}

/**
 * The same read, once, however many parts of a page ask for it.
 *
 * Every room page asked the database for that room **twice**: once in
 * `generateMetadata`, to write the title, and once in `Readable`, to render the
 * page. Same slug, same request, two round trips — and the post and profile
 * pages did the same. Nothing was wrong with either caller; they simply do not
 * know about each other, and the reads are ordinary Supabase calls rather than
 * `fetch` with a cache key, so nothing was going to notice on their behalf.
 *
 * `cache()` is per-request memoisation: within one render of one page the
 * second call gets the first call's promise, and the next visitor gets a fresh
 * read. So it halves the load on the first screen of every room without making
 * anything stale, which matters most on the day the free tier meets whatever
 * traffic the landing page sends.
 *
 * These return `undefined` rather than throwing, because **every path here has
 * to produce a page**: a title that throws is a 500 for a crawler. Both callers
 * already handle "nothing came back" by falling back to something generic.
 */
async function reader<T>(fetch: (env: Env) => Promise<T>): Promise<T | undefined> {
  try {
    const env = ogEnv()
    return env ? await fetch(env) : undefined
  } catch {
    return undefined
  }
}

export const readLobby = cache(() => reader((env) => env.listRooms()))
export const readRoom = cache((slug: string) => reader((env) => env.getRoom(slug)))
export const readProfile = cache((name: string) => reader((env) => env.getProfile(name)))
export const readPost = cache((room: string, postId: number) =>
  reader((env) => env.getPost(room, postId)),
)
