/**
 * Sending the key.
 *
 * Deliberately a bare HTTP call rather than an SDK: one request, no dependency,
 * and nothing to keep up to date. If no provider is configured the link goes to
 * the log exactly as it used to, so local development needs no account.
 *
 * The message is plain text on purpose. A site whose entire interface is a
 * prompt should not send a marketing email.
 */

import { CONTACT } from '@/lib/legal/documents'

export interface SendResult {
  sent: boolean
  /** What to tell the person, in their own terms. Never mentions a provider. */
  note: string
}

/**
 * The body of the mail, as plain text.
 *
 * Two ways in, and the **code comes first** — which is a reversal, and the
 * whole point of the change.
 *
 * A link signs you in wherever the link opens, and on a phone that is almost
 * never where you are. Gmail's app has its own browser with its own cookies, so
 * tapping the link signs you in *inside Gmail*, spends the single-use key doing
 * it, and leaves Safari — where you were actually reading — a stranger. The
 * same is true of Outlook, of Slack, of every in-app browser, and there is no
 * wording that fixes it: a cookie set in one browser is not readable in
 * another.
 *
 * A code has no browser in it. You read six characters, you type them into the
 * prompt you are already looking at, and the session lands there. It suits this
 * site better than a link ever did — the entire interface is a prompt.
 *
 * The link stays, because on a computer it is one click and this is four, and
 * because it is the only thing that works if somebody has closed the tab.
 */
function body(link: string, code: string | null): string {
  const lines = ['this signs you in, and keeps your name yours.', '']

  if (code) {
    lines.push(
      `  ${code}`,
      '',
      'type that at the prompt where you were reading. it works in',
      'whichever browser you are already in, which is the point of it —',
      'links opened from a mail app tend to land somewhere else.',
      '',
      'or, on a computer, click this instead:',
      '',
      link,
    )
  } else {
    lines.push(link)
  }

  lines.push(
    '',
    'both expire. you can always ask for another by typing login and',
    'your name at the prompt.',
    '',
    'if you did not ask for this, ignore it — nothing was created in',
    'your name that you did not create yourself.',
  )
  return lines.join('\n')
}

/**
 * @param code the six-character version of the same key, or null when the
 *   provider did not mint one.
 *
 *   **Required, with no default, and that is the fix rather than a style
 *   choice.** It used to default to `null` on the reasoning that signup does
 *   not need one — it mints the session server-side, so the link's only job is
 *   proving the address. Defensible, and it silently applied to `resend` too,
 *   which is the one email somebody asks for *because the link did not work*.
 *   Two of the three call sites sent no code, and nothing said so: an argument
 *   you can leave out is an argument that gets left out.
 *
 *   Writing `null` explicitly is still allowed. Forgetting is not.
 */
export async function sendMagicLink(
  to: string,
  link: string,
  code: string | null,
): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM

  if (!key || !from) {
    // Not an error. It is how this runs locally, and the link still works.
    console.log(`\n  magic link for ${to}:\n  ${link}\n${code ? `  code: ${code}\n` : ''}`)
    return {
      sent: false,
      note: 'no mail is configured here, so your key is in the server log.',
    }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        // People reply to transactional mail — usually to say "I didn't ask for
        // this". Without this it lands at whatever MAIL_FROM is, which is a
        // send-only address nobody reads. Both published documents name this
        // one as the way to reach a human, so it is the honest destination and
        // it saves MAIL_FROM ever needing to receive.
        reply_to: CONTACT,
        /*
         * The code is deliberately NOT in the subject line, which is the one
         * place people would most like it.
         *
         * A subject shows on a locked phone. Names here are public — they head
         * every post — so a code visible on a lock screen next to a known name
         * is a complete set of credentials readable by anyone standing behind
         * you, on a device they never have to unlock. Plenty of services make
         * this trade for the tap it saves. This one does not: the whole reason
         * the code exists is that somebody is on a phone, which is exactly when
         * the lock screen is in play.
         */
        subject: 'your key to thewall',
        text: body(link, code),
      }),
    })

    if (!response.ok) {
      // Log the reason, tell the person something they can act on.
      console.error(`sending to ${to} failed: ${response.status} ${await response.text()}`)
      return { sent: false, note: 'that address didn’t take the mail. type resend to try again.' }
    }

    return { sent: true, note: `your key is on its way to ${to}.` }
  } catch (error) {
    console.error('sending failed', error)
    return { sent: false, note: 'couldn’t send just now. type resend to try again.' }
  }
}
