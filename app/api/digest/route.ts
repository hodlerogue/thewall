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
  if (offered.length !== secret.length || offered !== secret) {
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
  const sentTo: string[] = []

  /*
   * One at a time, and stamped by what actually went out.
   *
   * Marking everybody the query returned would mean a provider outage costs a
   * whole day's notifications rather than a minute's, and nobody would hear
   * about it until tomorrow. Sequential rather than parallel because the
   * provider rate-limits, and because a digest run is not a place that needs to
   * be fast.
   */
  for (const row of due) {
    const digest: Digest = {
      name: row.name,
      email: row.email,
      unread: Number(row.unread),
      token: row.token,
    }
    if (await sendDigest(digest, site)) sentTo.push(row.profile_id)
  }

  if (sentTo.length > 0) {
    const { error: stampError } = await admin.rpc('mark_digested', { p_ids: sentTo })
    /*
     * Loud, because the failure mode is the bad one: the mail is already gone,
     * so an unstamped row is somebody who gets a second copy on the next run.
     */
    if (stampError) console.error('digest: sent but could not stamp', stampError)
  }

  return NextResponse.json({ sent: sentTo.length, due: due.length })
}
