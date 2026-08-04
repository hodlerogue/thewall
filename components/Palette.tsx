'use client'

import type { Chip } from '@/lib/shell/types'

/**
 * §3.6 — a glossary, not a toolbar.
 *
 * Every chip reads `verb — what it does`, and clicking one *inserts* that text
 * into the prompt with the cursor waiting. It never executes. That single
 * property is what keeps this a real interface instead of a button UI wearing a
 * terminal costume (§9), and it is why users graduate to typing on their own.
 */

/**
 * The one chip that sits outside the scroller.
 *
 * Measured, not assumed: at 380px exactly *one* chip fits, because a gloss
 * makes each of them 150–290px wide. So every position but the first is off the
 * right edge, and no amount of reordering fixes it — which meant the chip whose
 * entire audience is somebody who does not know what to do was the one they had
 * to already know to scroll for.
 *
 * Pinning it is honest rather than arbitrary: `help` is the only verb here that
 * is *about* the interface instead of about the place you are standing, so it
 * belongs to the row rather than to the context. Reordering the rest would have
 * cost the primary action its place, which is the bug this palette already had
 * once.
 */
const PINNED = 'help'

export function Palette({
  chips,
  onInsert,
}: {
  chips: readonly Chip[]
  onInsert: (text: string) => void
}) {
  const pinned = chips.find((chip) => chip.verb === PINNED)
  const scrolling = chips.filter((chip) => chip.verb !== PINNED)

  return (
    <div className="palette-row" role="group" aria-label="commands">
      <div className="palette">
        {scrolling.map((chip) => (
          <ChipButton key={chip.verb} chip={chip} onInsert={onInsert} />
        ))}
      </div>
      {pinned && <ChipButton chip={pinned} onInsert={onInsert} pinned />}
    </div>
  )
}

function ChipButton({
  chip,
  onInsert,
  pinned = false,
}: {
  chip: Chip
  onInsert: (text: string) => void
  pinned?: boolean
}) {
  return (
    <button
      type="button"
      className={pinned ? 'chip chip-pinned' : 'chip'}
      data-verb={chip.verb}
      /* The pinned chip drops its gloss to stay narrow enough to always fit,
         and hands it to the accessible name instead — so the one place §3.6's
         glossary rule bends visually, it does not bend for a screen reader. */
      aria-label={`${chip.verb} — ${chip.gloss}`}
      // Chips must not steal focus from the prompt, or mobile closes the
      // keyboard on every tap.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onInsert(chip.insert)}
    >
      <span className="chip-verb">{chip.verb}</span>
      {!pinned && <span className="chip-gloss"> — {chip.gloss}</span>}
    </button>
  )
}
