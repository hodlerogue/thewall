import Link from 'next/link'
import { CONTACT, LAST_UPDATED, TERMS, jurisdiction, type Document } from '@/lib/legal/documents'

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

      {/*
        * Loud on purpose, and only on the terms.
        *
        * An unset governing law is the one thing in these documents that can be
        * wrong by omission rather than by being written badly, and the failure
        * mode is silent — the page renders, reads fine, and quietly claims
        * nothing about where a dispute goes. So it announces itself at the top
        * where nobody can deploy past it, and one edit in documents.ts removes
        * it for good.
        */}
      {document === TERMS && jurisdiction() === null && (
        <p className="document-unfinished" role="status">
          Unfinished: no governing law has been set for this deployment. See the
          Law section below, and <code>jurisdiction()</code> in{' '}
          <code>lib/legal/documents.ts</code>.
        </p>
      )}

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
