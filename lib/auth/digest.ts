import { CONTACT } from '@/lib/legal/documents'

/**
 * The one email this site sends that nobody asked for in the moment.
 *
 * Plain text, like the key, and for the same reason: a site whose entire
 * interface is a prompt has no business sending a marketing email. It says how
 * many, where to go, and how to stop — and nothing else. No preview of what was
 * said, on purpose: the point is to bring somebody back, and a digest complete
 * enough to read instead of visiting is a digest that replaces the place.
 */
export interface Digest {
  name: string
  email: string
  unread: number
  token: string
}

export function digestText(digest: Digest, siteUrl: string): string {
  const many = digest.unread === 1 ? 'somebody answered you' : `${digest.unread} replies are waiting`
  return [
    `${many} on thewall.`,
    '',
    `${siteUrl}/lobby — type mail to read them.`,
    '',
    'you asked for this. to stop it, follow the link below, or type',
    'notify off at the prompt.',
    '',
    unsubscribeUrl(siteUrl, digest.token),
  ].join('\n')
}

export function digestSubject(unread: number): string {
  // The number in the subject, because the whole job of this email is to be
  // answerable from the notification shade without opening it.
  return unread === 1 ? 'one reply is waiting' : `${unread} replies are waiting`
}

export function unsubscribeUrl(siteUrl: string, token: string): string {
  return `${siteUrl}/unsubscribe?t=${encodeURIComponent(token)}`
}

/**
 * Sends one digest. Mirrors `sendMagicLink` deliberately — same bare HTTP call,
 * same behaviour with no provider configured, same reply-to.
 */
export async function sendDigest(digest: Digest, siteUrl: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM

  if (!key || !from) {
    console.log(`\n  digest for ${digest.email}: ${digest.unread} waiting\n`)
    return false
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: digest.email,
        reply_to: CONTACT,
        /*
         * RFC 8058. Mail clients render their own unsubscribe control from
         * these, and somebody who uses it never sees the site's page at all —
         * which is the point. An unsubscribe that is easier through Gmail's
         * button than through our link is an unsubscribe that works.
         *
         * One-click means the client sends a POST to that URL, and the URL is a
         * page rather than a route handler. That works — Next renders a dynamic
         * page for any method, so the token is acted on and a 200 comes back —
         * but it works by a property of the framework rather than by design, so
         * `e2e/order-and-login.spec.ts` pins it: a POST to that URL answers 200.
         * That the token is then acted on is covered by the database suite,
         * because the fixture build has no database to act on.
         */
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl(siteUrl, digest.token)}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        subject: digestSubject(digest.unread),
        text: digestText(digest, siteUrl),
      }),
    })

    if (!response.ok) {
      console.error(`digest to ${digest.email} failed: ${response.status}`)
      return false
    }
    return true
  } catch (error) {
    console.error('digest send failed', error)
    return false
  }
}
