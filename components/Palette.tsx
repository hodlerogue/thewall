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
export function Palette({
  chips,
  onInsert,
}: {
  chips: readonly Chip[]
  onInsert: (text: string) => void
}) {
  return (
    <div className="palette" role="group" aria-label="commands">
      {chips.map((chip) => (
        <button
          key={chip.verb}
          type="button"
          className="chip"
          data-verb={chip.verb}
          // Chips must not steal focus from the prompt, or mobile closes the
          // keyboard on every tap.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onInsert(chip.insert)}
        >
          <span className="chip-verb">{chip.verb}</span>
          <span className="chip-gloss"> — {chip.gloss}</span>
        </button>
      ))}
    </div>
  )
}
