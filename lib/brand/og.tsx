import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import { MARK_BLOCK, MARK_CHEVRON, MARK_GROUND, MARK_INK } from '@/lib/brand/mark'
import { THEMES } from '@/lib/shell/themes'
import type { Line, Tone } from '@/lib/shell/types'

/**
 * The card a link to this shows in a chat or a timeline.
 *
 * §3.4 calls shareable URLs a thing that "falls out of the design at zero
 * cost", and that is only true up to the moment somebody pastes one: without
 * this, `thewall.social/music/12` previews as a bare title and a domain, which
 * is the least persuasive possible version of a link to a conversation.
 *
 * So the card is a picture of the thing itself. It takes the same `Line[]` the
 * shell renders — from the same `renderRoom`, `renderPost` and `renderRoomList`
 * — and paints them with the same warm palette, so the preview cannot describe
 * a site that does not look like this. Tones and indentation map exactly as
 * `globals.css` maps them.
 */

export const OG_SIZE = { width: 1200, height: 630 }
export const OG_CONTENT_TYPE = 'image/png'

const WARM = THEMES.find((theme) => theme.name === 'warm')!.tokens

const COLOURS: Record<Tone, string> = {
  default: WARM['--fg'],
  echo: WARM['--fg-dim'],
  dim: WARM['--fg-dim'],
  faint: WARM['--fg-faint'],
  error: WARM['--error'],
  accent: WARM['--accent'],
}

/** §3.2 — depth is indentation, the same step the shell uses. */
const STEP = 26

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="${MARK_GROUND}"/>
  <path d="${MARK_CHEVRON}" fill="none" stroke="${MARK_INK}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <rect ${MARK_BLOCK} fill="${MARK_INK}"/>
</svg>`

/**
 * Vendored and subset to 17K rather than fetched at build time.
 *
 * The card is meaningless in a proportional face — the whole subject is a
 * terminal — and a build that reaches out to a font CDN is a build that fails
 * on somebody else's outage. Subset to Latin plus the punctuation the product
 * actually types (JetBrains Mono, OFL, licence beside it).
 */
async function typeface(): Promise<ArrayBuffer> {
  const file = await readFile(join(process.cwd(), 'assets', 'JetBrainsMono-subset.ttf'))
  return Uint8Array.from(file).buffer
}

/** How many lines fit before the footer. Beyond this the card is a wall. */
const MAX_LINES = 9

export async function ogCard({
  path,
  lines,
  footer = 'a place you navigate by typing.',
}: {
  /** What appears after the domain — '' for the front door, '/music/12' inside. */
  path: string
  lines: readonly Line[]
  footer?: string
}) {
  const shown = lines.slice(0, MAX_LINES)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: WARM['--bg'],
          padding: '48px 64px',
          fontFamily: 'mono',
          fontSize: 30,
          lineHeight: 1.45,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img
            width={56}
            height={56}
            src={`data:image/svg+xml;utf8,${encodeURIComponent(MARK)}`}
            alt=""
          />
          <div style={{ display: 'flex', marginLeft: 22, color: WARM['--accent'], fontSize: 40 }}>
            thewall.social{path}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            marginTop: 36,
            // Nothing may spill: a card is a fixed rectangle, and a line that
            // overflows it is not clipped by a scrollbar the way the shell is.
            overflow: 'hidden',
          }}
        >
          {shown.map((line, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                color: COLOURS[line.tone ?? 'default'],
                paddingLeft: (line.depth ?? 0) * STEP,
                // A blank line in the shell is spacing; here it has to hold its
                // height or the rhythm collapses.
                height: 42,
                whiteSpace: 'pre',
              }}
            >
              {truncateForCard(line.text, line.depth ?? 0)}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', color: WARM['--fg-faint'], fontSize: 26 }}>{footer}</div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [{ name: 'mono', data: await typeface(), style: 'normal', weight: 400 }],
    },
  )
}

/**
 * One line, at the width the card actually has where that line sits.
 *
 * Monospace makes this arithmetic rather than measurement: at 30px JetBrains
 * Mono is 18px to the character, and the text column is 1072px wide.
 *
 * The indent has to come out of the budget, which is the whole reason this
 * takes a depth. A flat 59 looked right on a post body and clipped a reply mid
 * word — no ellipsis, no signal, just a sentence that stopped, because §3.2
 * puts a reply body two steps in and nothing had subtracted them.
 */
export function truncateForCard(text: string, depth: number): string {
  const max = 59 - Math.ceil((depth * STEP) / 18)
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}
