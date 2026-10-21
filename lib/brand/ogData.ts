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
async function reader<T>(fetch: (env: Env) => Promise<T>): Promise<Attempt<T>> {
  try {
    const env = ogEnv()
    return env ? { answered: true, value: await fetch(env) } : { answered: false }
  } catch {
    return { answered: false }
  }
}

/**
 * Whether the database answered, kept apart from what it answered.
 *
 * A 404 has to mean "asked, and there is no such thing" — never "could not
 * ask". Collapsing both into `undefined` was fine while the only consequence
 * was a generic title, and stopped being fine once a missing room answered
 * with a real 404 (QA: `/nope404` came back 200 with a blank page). A blip
 * telling a search engine that `/music` does not exist would be worse than
 * the bug.
 */
type Attempt<T> = { answered: true; value: T } | { answered: false }

const value = <T>(attempt: Attempt<T | undefined>) => (attempt.answered ? attempt.value : undefined)
const absent = <T>(attempt: Attempt<T | undefined>) => attempt.answered && attempt.value === undefined

const lobby = cache(() => reader((env) => env.listRooms()))
const room = cache((slug: string) => reader((env) => env.getRoom(slug)))
const profile = cache((name: string) => reader((env) => env.getProfile(name)))
const post = cache((slug: string, postId: number) => reader((env) => env.getPost(slug, postId)))

export const readLobby = () => lobby().then(value)
export const readRoom = (slug: string) => room(slug).then(value)
export const readProfile = (name: string) => profile(name).then(value)
export const readPost = (slug: string, postId: number) => post(slug, postId).then(value)

/** True only when the database answered that there is no such room. */
export const roomIsMissing = (slug: string) => room(slug).then(absent)
/** True only when the database answered that there is nobody by that name. */
export const personIsMissing = (name: string) => profile(name).then(absent)
/** True only when the database answered that there is no such post. */
export const postIsMissing = (slug: string, postId: number) => post(slug, postId).then(absent)
