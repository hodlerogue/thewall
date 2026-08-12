import Link from 'next/link'
import { ogEnv } from '@/lib/brand/ogData'
import { formatAgo } from '@/lib/shell/model'
import { oldestFirst } from '@/lib/shell/render'
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
 * The first line of something, short enough to be a heading.
 *
 * Paired with `rest` below, and the pair is the fix for a real defect: a
 * heading built from the first 80 characters and a paragraph holding the whole
 * body printed **the same words twice** whenever a post was shorter than that,
 * which in commons is most of them. Reported as a flash of a broken-looking
 * page — "hi all", "ryan, 2m ago", "hi all" — and it was duplicate content to a
 * crawler for exactly the same reason.
 */
const HEADING = 80
const excerpt = (body: string) => body.split('\n')[0].slice(0, HEADING)

/** Whatever the heading did not already say. Empty when it said all of it. */
const rest = (body: string) => (body === excerpt(body) ? null : body)

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
            <p className="readable-body">{room.gloss}</p>
            {room.latest && (
              <p className="readable-body readable-said">
                {room.latest.body} — {room.latest.author},{' '}
                <time dateTime={room.latest.createdAt.toISOString()}>
                  {formatAgo(room.latest.createdAt)}
                </time>
              </p>
            )}
          </li>
        ))}
      </ul>
    </article>
  )
}

/**
 * A room, in the shape the terminal is about to draw it in.
 *
 * Reported as a flash: "it flashes this in the top left for a brief moment and
 * then loads the page." Some of that is unavoidable — this *is* the page until
 * the shell boots, and the alternative is the spinner it replaced — but almost
 * none of it needed to look like a different site. Three things did that:
 *
 * The body appeared twice, because the heading was an 80-character excerpt of
 * it and the paragraph below was the whole thing.
 *
 * The posts ran newest-first while the terminal runs them oldest-first, so the
 * order visibly flipped as it booted.
 *
 * And every post was a link, including in commons, which has no permanent
 * addresses at all (§3.10) — so the flash offered doors that do not exist.
 *
 * What is left mirrors `renderPosts`: the address and who said it on one line,
 * the body indented under it. A crawler still gets a heading, a link and a
 * `<time>` per post; a person gets the same room twice in a row.
 */
async function Room({ slug, env }: { slug: string; env: Env }) {
  const room = await env.getRoom(slug)
  if (!room) return null

  return (
    <article className="readable">
      <h1>{room.slug}</h1>
      <p className="readable-gloss">{room.gloss}</p>
      {room.ephemeral && (
        <p className="readable-gloss">
          commons keeps nothing. everything here is gone in 24 hours.
        </p>
      )}
      {room.posts.length === 0 && <p>nothing here yet.</p>}
      {oldestFirst(room.posts).map((post) => (
        <section key={post.id}>
          <h2>
            {/* No address in an ephemeral room, so nothing to link to and
                nothing to print in front — the same branch renderPosts takes. */}
            {!room.ephemeral && (
              <>
                <Link href={`/${room.slug}/${post.id}`}>{post.id}</Link>{' '}
              </>
            )}
            <span className="readable-said">
              {post.author},{' '}
              <time dateTime={post.createdAt.toISOString()}>{formatAgo(post.createdAt)}</time>
            </span>
          </h2>
          <p className="readable-body">{post.body}</p>
          {!room.ephemeral && post.replies.length > 0 && (
            <p className="readable-count">
              {post.replies.length} {post.replies.length === 1 ? 'reply' : 'replies'}
            </p>
          )}
        </section>
      ))}
      <p className="readable-nav">
        <Link href="/lobby">every room</Link>
      </p>
    </article>
  )
}

async function Thread({ at, env }: { at: Location; env: Env }) {
  const post = await env.getPost(at.room!, at.postId!)
  if (!post) return null

  return (
    <article className="readable">
      <h1>{excerpt(post.body)}</h1>
      <p className="readable-said">
        {post.author}, <time dateTime={post.createdAt.toISOString()}>{formatAgo(post.createdAt)}</time>{' '}
        in <Link href={`/${at.room}`}>{at.room}</Link>
      </p>
      {/* Only when the heading did not already say it. */}
      {rest(post.body) && <p className="readable-body">{post.body}</p>}
      {post.replies.map((reply) => (
        <section key={reply.id}>
          <p className="readable-said">
            {reply.author},{' '}
            <time dateTime={reply.createdAt.toISOString()}>{formatAgo(reply.createdAt)}</time>
          </p>
          <p className="readable-body">{reply.body}</p>
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
      <p className="readable-said">
        arrived{' '}
        <time dateTime={profile.joinedAt.toISOString()}>{formatAgo(profile.joinedAt)}</time>.
      </p>
      {profile.posts.map((post) => (
        <section key={`${post.room}/${post.id}`}>
          <h2>
            <Link href={`/${post.room}/${post.id}`}>
              {post.room}/{post.id}
            </Link>
          </h2>
          <p className="readable-body">{post.body}</p>
        </section>
      ))}
    </article>
  )
}
