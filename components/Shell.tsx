'use client'

import { Terminal } from '@/components/Terminal'
import { phase1Chips, phase1Intro, phase1Run } from '@/lib/shell/phase1Runner'

/**
 * Wiring seam: the client boundary that hands the Terminal its runner. Phase 2
 * swaps phase1Run for the command registry and Phase 3 gives that registry real
 * data — the Terminal itself does not change.
 */
export function Shell() {
  return (
    <Terminal
      initialLines={phase1Intro()}
      initialLocation={{ room: 'commons' }}
      run={phase1Run}
      chipsFor={phase1Chips}
      name={null}
    />
  )
}
