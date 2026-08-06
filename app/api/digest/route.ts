import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { sendDigest, type Digest } from '@/lib/auth/digest'
import { siteUrl } from '@/lib/auth/links'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * The daily run. Sends one email to each person who asked for one and has
 * something waiting, and nothing to anybody else.
 *
 * Called by a scheduler, not by a person — see GOING-LIVE.md. It is a POST
 * with a shared secret rather than a GET, because a GET that sends mail is one
 * crawler away from being sent twice, and because link prefetchers follow GETs.
 *
 * Everything that decides *who* is in `pending_digests()`, which is
 * service-role only. This route is the part that can send email, so it holds
 * the secret and nothing else.
 */
/**
 * How many to send in one run.
 *
 * This runs inside a serverless function with a hard timeout, and each send is
 * a network round trip to the mail provider. Past some number the function is
 * killed part-way through — so the number is chosen rather than discovered, and
 * whatever is left over is still due on the next run.
 */
const MAX_PER_RUN = 200

/** Constant-time, so the response time cannot be used to guess the secret. */
function sameSecret(offered: string, secret: string): boolean {
  const a = Buffer.from(offered)
  const b = Buffer.from(secret)
  // `timingSafeEqual` throws on a length mismatch, and that error path would
  // return faster than a comparison — so a mismatched length does an equivalent
  // amount of work before answering.
  if (a.length !== b.length) {
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  const secret = process.env.DIGEST_SECRET

  /*
   * No secret configured means the route is off, not open. A deployment that
   * forgot to set it should send nothing rather than let anybody on the
   * internet trigger a send — which is the failure that turns a mailing job
   * into somebody else's rate limit.
   */
  if (!secret) {
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }

  const offered = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!sameSecret(offered, secret)) {
    return NextResponse.json({ error: 'no' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('pending_digests')
  if (error) {
    console.error('digest: could not read who is due', error)
    return NextResponse.json({ error: 'could not read' }, { status: 500 })
  }

  const due = (data ?? []) as {
    profile_id: string
    name: string
    email: string
    unread: number
    token: string
  }[]

  if (due.length === 0) {
    // A day when nobody was answered is a day with no email, which is the whole
    // difference between this and a daily reminder that nothing happened.
    return NextResponse.json({ sent: 0, due: 0 })
  }

  const site = siteUrl(request)
  let sent = 0
  let stampFailures = 0

  /*
   * One at a time, and each stamped the moment its mail is accepted.
   *
   * Collecting the ids and stamping once at the end is fewer round trips and
   * the wrong trade. This runs in a serverless function with a hard timeout: a
   * run big enough to be cut off part-way would have sent a pile of email and
   * stamped none of it, so every one of those people gets a second copy on the
   * next run. Stamping as it goes costs at most the one send in flight.
   *
   * Sequential rather than parallel because the provider rate-limits, and a
   * digest run is not a place that needs to be fast.
   */
  const batch = due.slice(0, MAX_PER_RUN)
  for (const row of batch) {
    const digest: Digest = {
      name: row.name,
      email: row.email,
      unread: Number(row.unread),
      token: row.token,
    }
    if (!(await sendDigest(digest, site))) continue
    sent += 1

    const { error: stampError } = await admin.rpc('mark_digested', { p_ids: [row.profile_id] })
    /*
     * Loud, because this is the bad direction: the mail has already gone, so an
     * unstamped row is somebody who gets a second copy tomorrow.
     */
    if (stampError) {
      stampFailures += 1
      console.error('digest: sent but could not stamp', row.profile_id, stampError)
    }
  }

  // No silent caps. Whoever is past the limit is still due and goes out on the
  // next run, but a run that quietly did half its work reads as one that
  // finished.
  if (due.length > MAX_PER_RUN) {
    console.warn(`digest: ${due.length} due, sent ${MAX_PER_RUN} this run; the rest are still due`)
  }

  return NextResponse.json({
    sent,
    due: due.length,
    ...(stampFailures > 0 ? { stampFailures } : {}),
    ...(due.length > MAX_PER_RUN ? { deferred: due.length - MAX_PER_RUN } : {}),
  })
}
