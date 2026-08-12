import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Demo } from '@/components/Demo'
import { Scrollback } from '@/components/Scrollback'
import {
  CARD_ALT,
  CARD_BODY,
  CARD_HEADING,
  CARD_ROOM,
  CLOSING,
  CTA_PRIMARY,
  CTA_SECONDARY,
  DEMO_FOOTNOTE,
  DESCRIPTION,
  HEADLINE,
  POSTER_ALT,
  PROOFS,
  STATEMENT,
  SUBHEAD,
  WORDMARK,
} from '@/lib/marketing/landing'
import { describe } from '@/lib/seo/pages'
import { fixtureEnv } from '@/lib/shell/env'
import { renderRoomList } from '@/lib/shell/render'
import type { Line } from '@/lib/shell/types'
import { FRONT_DOOR, promptLabel } from '@/lib/shell/types'

/**
 * The page you send somebody who has not seen this before.
 *
 * `/about` is the rundown — 1,400 words, and written on purpose with "no
 * marketing, no feature bullets". That is right for somebody who has already
 * arrived and wants to understand what they found, and useless as a link in a
 * group chat, which has about four seconds. This is the four seconds.
 *
 * A page of its own rather than the front door: `/` still redirects into
 * commons (§3.10), so nothing about how this site is entered has changed. The
 * cost of that choice is that `hello` can never be a room name, which is why
 * there is a migration beside this reserving it.
 *
 * Everything except the demo is server-rendered, so the words are in the HTML
 * for a crawler and on the screen before any script arrives.
 */

/**
 * The share card, named rather than inherited — and the reason that is not a
 * simplification.
 *
 * A page that declares `openGraph` at all **replaces** the one the root layout
 * declared, and with it the image Next attaches from `app/opengraph-image.png`.
 * Measured on the built site: with a page-level `openGraph` block carrying only
 * a title and a description, `/hello` came back with no `og:image` at all,
 * `og:type` gone and `og:site_name` gone. Nothing warns; the tag is simply not
 * there, and the only place to notice is somebody else's timeline.
 *
 * So everything the layout was providing is restated here, and the image is
 * named by the path Next serves it from. That path is a hard-coded string,
 * which is a thing this file is not allowed to get away with — `e2e/landing`
 * fetches it and checks it is a real 1200×630 image, so a rename breaks a test
 * rather than a preview.
 *
 * The alt text is read from the file beside the image rather than written out
 * again, for the ordinary reason: two copies, one of them updated.
 *
 * `og:url` is deliberately absent, here as everywhere. X caches a scrape per
 * URL for about a week, and without an `og:url` pinning the canonical address,
 * `?v=2` on the end of a link is enough to make it fetch again.
 */
const CARD = {
  url: '/opengraph-image.png',
  width: 1200,
  height: 630,
  alt: readFileSync(join(process.cwd(), 'app/opengraph-image.alt.txt'), 'utf8'),
}

export const metadata: Metadata = {
  title: `${HEADLINE.replace(/\.$/, '')} — ${WORDMARK}`,
  description: describe(DESCRIPTION),
  alternates: { canonical: '/hello' },
  openGraph: {
    type: 'website',
    siteName: WORDMARK,
    title: `${WORDMARK} — ${HEADLINE}`,
    description: describe(DESCRIPTION),
    images: [CARD],
  },
}

/**
 * What the demo frame holds until its own JavaScript is running.
 *
 * Read from the fixtures rather than the database, and deliberately: this is
 * the frame the demo itself starts from, so the two have to agree — and a
 * marketing page that 500s because a database blipped is worse than one showing
 * example rooms, which is all these ever were.
 */
async function openingFrame(): Promise<Line[]> {
  const { rooms, total } = await fixtureEnv().listRooms()
  return [
    { text: `${promptLabel(null, {})} look`, tone: 'echo' },
    { text: '' },
    ...renderRoomList(rooms, undefined, undefined, total),
  ]
}

/**
 * The site's own renderer, on the server.
 *
 * `components/Scrollback.tsx` and nothing else — this page had its own copy of
 * the markup for about a day, and in that day it lost the dim prompt in front
 * of a contribution, the height of a blank line, and the styling of an address.
 * There is no handler to hand it here, which it allows: a tap token still looks
 * like one, it simply is not a button until the demo is running.
 */
function Lines({ lines }: { lines: readonly Line[] }) {
  return <Scrollback lines={lines.map((line, key) => ({ ...line, key }))} />
}

export default async function Page() {
  const frame = await openingFrame()

  return (
    <main className="landing">
      <div className="landing-inner">
        {/*
          * The demo is the argument, so it is the first screen.
          *
          * It used to be the eighth thing you saw: wordmark, headline, rule,
          * five lines of subhead, and two buttons — one of them a way out —
          * before the working copy of the product appeared, below the fold on a
          * phone. A page that offers you the exit before the reason to stay has
          * its order backwards. Everything above the frame is now four lines,
          * and the call to action sits underneath it, where it reads as "the
          * real one is over here" rather than "leave now".
          */}
        <header className="landing-hero">
          <p className="landing-mark">
            <span className="landing-chevron">&gt;_</span> {WORDMARK}
          </p>
          <h1 className="landing-headline">{HEADLINE}</h1>
          <p className="landing-sub">{SUBHEAD}</p>

          <Demo>
            <Lines lines={frame} />
          </Demo>
          <p className="landing-footnote">{DEMO_FOOTNOTE}</p>

          <p className="landing-actions">
            <Link className="landing-button" href={`/${FRONT_DOOR}`}>
              {CTA_PRIMARY} →
            </Link>
            <Link className="landing-link" href="/about">
              {CTA_SECONDARY}
            </Link>
          </p>
        </header>

        {/* The one place the page raises its voice. Without a break in scale
            every section reads at the same volume, which is a list rather than
            an argument. */}
        <section className="landing-statement">
          <p>{STATEMENT}</p>
        </section>

        <section className="landing-proofs" aria-label="what it is like">
          {PROOFS.map((proof) => (
            <article className="proof" key={proof.heading}>
              <h2>{proof.heading}</h2>
              <p>{proof.body}</p>
              <div className="proof-sample">
                <Lines lines={proof.sample} />
              </div>
            </article>
          ))}
        </section>

        <section className="landing-card">
          <h2>{CARD_HEADING}</h2>
          <p>{CARD_BODY}</p>
          {/*
            * The card route itself, not a copy of one.
            *
            * `/{room}/opengraph-image` is what a crawler fetches when somebody
            * pastes a link to that room, and it is drawn from `renderRoom` — the
            * same function the screen uses. Pointing the img at it means the
            * picture on this page cannot flatter the product, cannot go stale,
            * and cannot be a mock-up, because there is nothing here to mock one
            * up with. A plain img, since Next's optimiser has nothing to do with
            * a route that renders its own PNG.
            */}
          <img
            className="landing-shot"
            src={`/${CARD_ROOM}/opengraph-image`}
            alt={CARD_ALT}
            width={1200}
            height={630}
            loading="lazy"
            decoding="async"
          />
        </section>

        <section className="landing-end">
          <p className="landing-closing">{CLOSING}</p>
          {/*
            * The poster, where it is not claiming anything.
            *
            * Drawn rather than captured: the rooms and commands in it are the
            * real ones, the layout is an illustrator's. That is fine for brand
            * art and not fine as evidence, which is what it was being used as a
            * section ago. Here it sits under the wordmark with nothing asserted
            * about it, above the last way in.
            */}
          <img
            className="landing-poster"
            src="/thewallopengraph.png"
            alt={POSTER_ALT}
            width={1600}
            height={840}
            loading="lazy"
            decoding="async"
          />
          <p className="landing-actions">
            <Link className="landing-button" href={`/${FRONT_DOOR}`}>
              {CTA_PRIMARY} →
            </Link>
          </p>
          <p className="landing-footer">
            <Link href="/about">about</Link> · <Link href="/lobby">the rooms</Link> ·{' '}
            <Link href="/terms">terms</Link> · <Link href="/privacy">privacy</Link>
          </p>
        </section>
      </div>
    </main>
  )
}
