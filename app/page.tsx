import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { hasSession } from '@/lib/auth/member'
import { FRONT_DOOR } from '@/lib/shell/types'

/**
 * The front door.
 *
 * §3.10 — you start in commons, once you have an account. It is a peer room
 * rather than special structure, so the front door simply puts you in it; the
 * lobby has its own address at /lobby and stays a pure directory, one `leave`
 * away. Somebody who has never signed in is shown /hello first — see below.
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

  const query = params.toString()

  /*
   * A query string means a message for the prompt — above all the outcome of a
   * magic link, which `/auth/callback` sends here. A key that *failed* leaves
   * no session behind, so without this rule the one person who most needs to
   * be told what went wrong would be shown the marketing page instead.
   */
  if (query) redirect(`/${FRONT_DOOR}?${query}`)

  /*
   * Somebody new sees what this is; somebody with an account goes straight in.
   *
   * Asked for as "the primary marketing page before you've logged in", after
   * "I'm having trouble getting to thewall homepage". There was no way to get
   * there: this redirected everybody into commons (§3.10), and the only link to
   * /hello was in the footer of /about. §3.10 still holds for anybody who has
   * been here — the decision being changed is what a stranger sees first.
   *
   * A crawler has no session, so the bare domain's share card is now /hello's,
   * which is the card made for people who have not seen this before.
   */
  redirect(hasSession((await cookies()).getAll()) ? `/${FRONT_DOOR}` : '/hello')
}
