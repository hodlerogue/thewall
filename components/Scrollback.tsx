'use client'

import { memo } from 'react'
import { withoutHints } from '@/lib/shell/hints'
import type { Line } from '@/lib/shell/types'

/**
 * The one renderer for a line of this interface.
 *
 * It lived inside `components/Terminal.tsx` while the terminal was the only
 * thing drawing lines. The landing page's demo drew its own, and every detail
 * it did not copy became a way the demo was not the site: `prefix` was ignored,
 * so the echo of a contribution rendered flat instead of a dim `guest:music$
 * say ` in front of a bright sentence — which is the one piece of typography
 * this product spends anything on (§3.9). Addresses rendered as text rather
 * than as the buttons they are, so nothing could be tapped. Blank lines
 * collapsed instead of holding their height.
 *
 * Reported as "even something as simple as saying something looks different
 * here than the real site", which it was. So there is one of these now, and a
 * second copy cannot be written without deleting this comment.
 *
 * Memoised because `Terminal` keeps `input` in state: without this, every
 * keystroke re-rendered every line ever printed. Measured at 380×740, about
 * 0.007ms per line per keystroke — which at a 600-line cap was several
 * milliseconds a letter on a phone, and was quietly setting how much of a room
 * could be shown at once.
 */

export type Keyed = Line & { key: number }

let nextKey = 0
const withKey = (line: Line): Keyed => ({ ...line, key: (nextKey += 1) })

/**
 * How much scrollback to keep.
 *
 * It grew without bound: no cap, no clear, no virtualisation, and every append
 * copies the array and forces a layout read for the autoscroll. A tab left
 * overnight — commons is explicitly meant to be left open, §3.10 calls it a
 * hallway — became a typing-latency problem and then a tab mobile Safari
 * reloads out from under you, taking a held sentence with it.
 *
 * Raised from 600 once typing stopped re-rendering it. It now holds roughly
 * seven pages of a busy room, so `older` can walk back a long way without the
 * page you started on being trimmed out from under you — which at 600 it
 * would have been, after one step.
 */
export const MAX_LINES = 1500

/**
 * The only way a line gets into a scrollback, on the site or in the demo.
 *
 * `hints off` is applied here rather than in the renderers, which is the whole
 * reason it is one line of code: everything printed passes through this —
 * command output, the boot lines, anything arriving live — and no renderer has
 * to learn that a setting exists.
 *
 * Keys are minted here too, and they have to be: index keys were correct only
 * while the array was append-only, and the cap below makes it not.
 */
export function append(previous: Keyed[], incoming: readonly Line[]): Keyed[] {
  const next = [...previous, ...withoutHints(incoming).map(withKey)]
  return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next
}

export const Scrollback = memo(function Scrollback({
  lines,
  /**
   * What tapping an address types for you.
   *
   * Optional, and the absence is not a degraded mode: the server renders this
   * too — the frame the demo starts from, and the samples on the landing page —
   * where there is no handler to hand it and nothing to tap yet. The token keeps
   * its own styling either way, so the line looks the same in both.
   */
  onInsert,
}: {
  lines: readonly Keyed[]
  onInsert?: (text: string) => void
}) {
  return (
    <>
      {lines.map((line) => (
        <p
          key={line.key}
          className={[
            'line',
            line.tone && line.tone !== 'default' ? `line-${line.tone}` : '',
            line.depth ? `depth-${line.depth}` : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {line.prefix ? <span className="line-prefix">{line.prefix}</span> : null}
          {line.tap ? (
            <>
              {onInsert ? (
                <button
                  type="button"
                  className="line-tap"
                  data-testid="tap"
                  /*
                   * Not a tab stop. The scrollback is one focusable region on
                   * purpose (WCAG 2.1.1, so a keyboard user can read their own
                   * history), and a room listing would put sixty stops between
                   * that region and the prompt. This is a shortcut for a thumb:
                   * everything it does, typing does, so leaving it out of the
                   * tab order costs a keyboard user nothing. The address itself
                   * stays ordinary text in the log for anything reading the
                   * line aloud.
                   */
                  tabIndex={-1}
                  aria-label={`answer ${line.tap.token}`}
                  // Same as a chip: never steal focus from the prompt, or the
                  // keyboard closes on every tap.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onInsert(line.tap!.insert)}
                >
                  {line.tap.token}
                </button>
              ) : (
                <span className="line-tap">{line.tap.token}</span>
              )}
              {line.text.slice(line.tap.token.length)}
            </>
          ) : line.text === '' ? (
            ' '
          ) : line.prefix ? (
            // Explicit rather than leaning on `:has()`. The prefix recedes and
            // this does not, which is the whole point of the pair existing.
            <span className="line-typed">{line.text}</span>
          ) : (
            line.text
          )}
        </p>
      ))}
    </>
  )
})
