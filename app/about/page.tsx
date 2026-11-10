import type { Metadata } from 'next'
import Link from 'next/link'
import { ABOUT } from '@/lib/guide/about'
import { COMMANDS } from '@/lib/commands/registry'
import { CONTACT } from '@/lib/legal/documents'
import { START } from '@/lib/shell/types'

export const metadata: Metadata = {
  title: 'about — thewall.social',
  description:
    'What thewall.social is, why the whole interface is a command prompt, and how to use it.',
}

/**
 * The rundown, for somebody who has just found a command prompt on a social
 * site and would like to know what they are looking at.
 *
 * `CHANGING-IT.md` argues against a user manual, and is right about the half it
 * is arguing about: a hand-written list of commands drifts away from the
 * registry that generates `help`, and then there are two answers to the same
 * question and one of them is wrong. That is answered here rather than argued
 * with — the prose is written once in `lib/guide/about.ts`, and the list of
 * verbs below is **generated from `COMMANDS`**, so it cannot say anything the
 * prompt would not.
 *
 * A page rather than a command, for the same reason the policies are one: it
 * has to be readable by somebody who has not typed anything yet, who arrived
 * from a link, or who is deciding whether this is worth their time. `about` in
 * the prompt prints the short version and names this address.
 */
export default function Page() {
  // Hidden commands stay hidden (§4.8 — the pipe is found by curiosity, not
  // advertised), and aliases are never announced (§3.5).
  const verbs = COMMANDS.filter((command) => !command.hidden)
  let step = 0

  return (
    <main className="document">
      <h1>thewall</h1>
      <p className="document-meta">a social site that is entirely a command prompt</p>

      {ABOUT.map((section) => (
        <section key={section.heading}>
          <h2>{section.step ? `${++step}. ${section.heading}` : section.heading}</h2>
          {section.body.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
          {section.examples && (
            <dl className="glossary">
              {section.examples.map((example) => (
                <div key={`${example.type}-${example.does}`}>
                  <dt>
                    <code>{example.type}</code>
                  </dt>
                  <dd>{example.does}</dd>
                </div>
              ))}
            </dl>
          )}
          {section.forms && (
            <dl className="glossary">
              {section.forms.map((form) => {
                const [typed, does] = form.split(' — ')
                return (
                  <div key={form}>
                    <dt>
                      <code>{typed}</code>
                    </dt>
                    <dd>{does}</dd>
                  </div>
                )
              })}
            </dl>
          )}
          {section.commands && (
            <dl className="glossary glossary-commands">
              {verbs.map((command) => (
                <div key={command.verb}>
                  <dt>
                    <code>{command.verb}</code>
                  </dt>
                  {/*
                    * The one-line gloss, not the full `detail`.
                    *
                    * §4.8 asks that the pipe be "documented only inside `what
                    * posts`, discoverable by the curious — don't advertise it",
                    * and `find`'s detail carries the example that does exactly
                    * that. So the page is a map and `what` stays the reference.
                    *
                    * Glossed for a room, since that is where somebody reading
                    * this will most likely be standing.
                    */}
                  <dd>{command.gloss('room')}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}

      <p className="document-meta">
        <Link href="/hello">the short version</Link> · <Link href="/terms">terms</Link> ·{' '}
        <Link href="/privacy">privacy</Link> · <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>
      <p className="document-meta">
        <Link href={START}>← go to the prompt</Link>
      </p>
    </main>
  )
}
