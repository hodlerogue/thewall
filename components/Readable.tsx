import Link from 'next/link'
import { ogEnv } from '@/lib/brand/ogData'
import { formatAgo } from '@/lib/shell/model'
import type { Location } from '@/lib/shell/types'

/**
 * The same place, as a page, rendered on the server.
 *
 * Measured against the built site before this existed: `/music` and `/music/12`
 * returned **two words** of HTML — the loading line — and `/` and `/lobby`
 * contained zero `<a href>` between them. Everything is fetched in the browser,
 * so a crawler was handed an empty prompt and no way to reach a second page.
 *
 * This is not a copy of the terminal and not a hidden block for robots. It is
 * what the site is before its JavaScript arrives: a room is a list of what
 * people said, a post is a conversation, and both are made of links. The shell
 * replaces it the moment it boots, which is also why the first paint stopped
 * being a spinner — the SEO fix and the speed fix are the same change.
 *
 * Nothing here is `noindex` and nothing is hidden. Whatever a crawler reads,
 * somebody with JavaScript switched off reads too, which is the only version of
 * this that is honest.
 */

/** Everything a reader can be handed, or nothing when there is no database. */
export async function Readable({ at }: { at: Location }) {
  const env = ogEnv()
  if (!env) return null

  try {
    if (at.person !== undefined) return <Person name={at.person} env={env} />
    if (at.room === undefined) return <Lobby env={env} />
    if (at.postId !== undefined) return <Thread at={at} env={env} />
    return <Room slug={at.room} env={env} />
  } catch {
    // A page that throws is worse than a page with a prompt on it. The shell
    // boots either way and says what went wrong in its own words.
    return null
  }
}

type Env = NonNullable<ReturnType<typeof ogEnv>>

/**
 * The lobby, which is the only page that can hand a crawler the whole site.
 *
 * There is no other link graph: navigation is a command prompt, so `go music`
 * leaves no trace a robot can follow. Every listable room is named here — not
 * the six the terminal shows, because this list exists to be followed rather
 * than read at a glance.
 */
async function Lobby({ env }: { env: Env }) {
  const { rooms } = await env.listRooms()

  return (
    <article className="readable">
      <h1>thewall.social</h1>
      <p>
        A social site where the whole interface is a command prompt. These are the rooms;
        walk into one and read what people said there. <Link href="/about">What this is</Link>.
      </p>
      <ul>
        {rooms.map((room) => (
          <li key={room.slug}>
            <h2>
              <Link href={`/${room.slug}`}>{room.slug}</Link>
            </h2>
            <p>{room.gloss}</p>
            {room.latest && (
              <p>
                {room.latest.author}: {room.latest.body}
              </p>
            )}
          </li>
        ))}
      </ul>
    </article>
  )
}

async function Room({ slug, env }: { slug: string; env: Env }) {
  const room = await env.getRoom(slug)
  if (!room) return null

  return (
    <article className="readable">
      <h1>{room.slug}</h1>
      <p>{room.gloss}</p>
      {room.posts.length === 0 && <p>Nothing here yet.</p>}
      {room.posts.map((post) => (
        <section key={post.id}>
          <h2>
            <Link href={`/${room.slug}/${post.id}`}>
              {post.body.split('\n')[0].slice(0, 80)}
            </Link>
          </h2>
          <p>
            {post.author}, <time dateTime={post.createdAt.toISOString()}>{formatAgo(post.createdAt)}</time>
          </p>
          <p>{post.body}</p>
        </section>
      ))}
      <p>
        <Link href="/lobby">Every room</Link>
      </p>
    </article>
  )
}

async function Thread({ at, env }: { at: Location; env: Env }) {
  const post = await env.getPost(at.room!, at.postId!)
  if (!post) return null

  return (
    <article className="readable">
      <h1>{post.body.split('\n')[0].slice(0, 80)}</h1>
      <p>
        {post.author}, <time dateTime={post.createdAt.toISOString()}>{formatAgo(post.createdAt)}</time>{' '}
        in <Link href={`/${at.room}`}>{at.room}</Link>
      </p>
      <p>{post.body}</p>
      {post.replies.map((reply) => (
        <section key={reply.id}>
          <p>
            {reply.author},{' '}
            <time dateTime={reply.createdAt.toISOString()}>{formatAgo(reply.createdAt)}</time>
          </p>
          <p>{reply.body}</p>
        </section>
      ))}
    </article>
  )
}

async function Person({ name, env }: { name: string; env: Env }) {
  const profile = await env.getProfile(name)
  if (!profile) return null

  return (
    <article className="readable">
      <h1>{profile.name}</h1>
      <p>
        Arrived <time dateTime={profile.joinedAt.toISOString()}>{formatAgo(profile.joinedAt)}</time>.
      </p>
      {profile.posts.map((post) => (
        <section key={`${post.room}/${post.id}`}>
          <h2>
            <Link href={`/${post.room}/${post.id}`}>
              {post.body.split('\n')[0].slice(0, 80)}
            </Link>
          </h2>
          <p>{post.body}</p>
        </section>
      ))}
    </article>
  )
}
