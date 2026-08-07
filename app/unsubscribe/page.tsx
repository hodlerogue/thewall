import type { Metadata } from 'next'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'unsubscribed — thewall.social',
  // Nothing here should ever be indexed, and the page only means anything to
  // somebody holding a token from an email.
  robots: { index: false, follow: false },
}

/**
 * The link at the bottom of every digest.
 *
 * It is followed on whatever device the email was opened on, which is very
 * often not the one that is signed in — so this takes the token from the URL
 * and nothing else. Requiring a session to stop email is how an unsubscribe
 * link becomes a lie.
 *
 * It acts on the GET rather than showing a button first. That means an email
 * client which prefetches links can switch somebody's digest off without them
 * asking — a real cost, and the smaller one: the alternative is an unsubscribe
 * that does not work on the first try, and the failure it prevents is undone by
 * typing `notify on`. RFC 8058's one-click header is sent alongside for clients
 * that support it, which is the path most people will actually take.
 *
 * The token can only ever turn things off. It reads nothing, says nothing, and
 * cannot be used to switch anybody's email back on.
 */
export default async function Unsubscribe({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>
}) {
  const token = (await searchParams).t ?? ''

  let outcome: 'done' | 'unknown' | 'broken' = 'unknown'
  if (/^[0-9a-f-]{36}$/i.test(token)) {
    try {
      const { data, error } = await createAdminClient().rpc('unsubscribe', { p_token: token })
      outcome = error ? 'broken' : data === true ? 'done' : 'unknown'
    } catch {
      outcome = 'broken'
    }
  }

  return (
    <main className="page">
      <h1>thewall.social</h1>

      {outcome === 'done' && (
        <>
          <p>that’s off. no more email.</p>
          <p className="quiet">
            replies still wait for you at the prompt — type <code>mail</code> when you next drop
            in. if you change your mind, <code>notify on</code> turns this back on.
          </p>
        </>
      )}

      {outcome === 'unknown' && (
        <>
          <p>that link doesn’t match anything.</p>
          <p className="quiet">
            it may have been used already, in which case nothing more is being sent to you. you can
            always type <code>notify off</code> at the prompt to be sure.
          </p>
        </>
      )}

      {outcome === 'broken' && (
        <>
          <p>something went wrong turning that off.</p>
          <p className="quiet">
            type <code>notify off</code> at the prompt and it will stop — that path does not depend
            on this page working.
          </p>
        </>
      )}

      <p className="quiet">
        <Link href="/lobby">back to thewall</Link>
      </p>
    </main>
  )
}
