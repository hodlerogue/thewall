import Link from 'next/link'
import { CONTACT, LAST_UPDATED, type Document } from '@/lib/legal/documents'

/**
 * The one place in this product that is a page rather than a prompt.
 *
 * §3 says the entire interface is a command prompt, and `terms` and `privacy`
 * honour that — they print into the scrollback like everything else. But a
 * policy also has to be readable by somebody who has not made an account, who
 * arrived from a link in an email, or who is checking whether this is safe
 * before typing an address into it. A document that can only be reached by
 * knowing a command is not published.
 *
 * So it is a page, and it is deliberately the plainest possible one: the same
 * type, the same colours, one column, no navigation, nothing to click except
 * the way back.
 */
export function LegalPage({ document }: { document: Document }) {
  return (
    <main className="document">
      <h1>{document.title}</h1>
      <p className="document-meta">thewall.social — last updated {LAST_UPDATED}</p>

      {document.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.body.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </section>
      ))}

      <p className="document-meta">
        Questions, or any of the requests above: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>
      <p className="document-meta">
        <Link href="/">← back to the prompt</Link>
      </p>
    </main>
  )
}
