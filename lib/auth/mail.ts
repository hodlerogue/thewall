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

export interface SendResult {
  sent: boolean
  /** What to tell the person, in their own terms. Never mentions a provider. */
  note: string
}

export async function sendMagicLink(to: string, link: string): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM

  if (!key || !from) {
    // Not an error. It is how this runs locally, and the link still works.
    console.log(`\n  magic link for ${to}:\n  ${link}\n`)
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
        subject: 'your key to thewall',
        text: [
          'this link signs you in, and keeps your name yours.',
          '',
          link,
          '',
          'it expires, but you can always ask for another one by typing',
          'resend at the prompt.',
          '',
          'if you did not ask for this, ignore it — nothing was created in',
          'your name that you did not create yourself.',
        ].join('\n'),
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
