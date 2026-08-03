'use client'

import { useMemo } from 'react'
import { Terminal } from '@/components/Terminal'
import { createChipsFor, createRunner } from '@/lib/commands/run'
import { fixtureEnv } from '@/lib/shell/env'
import { ROOMS } from '@/lib/shell/fixtures'
import { renderRoom } from '@/lib/shell/render'
import type { Line } from '@/lib/shell/types'

/**
 * Wiring seam: the client boundary that hands the Terminal its runner. Phase 3
 * replaces fixtureEnv with a Supabase-backed Env — nothing else here changes.
 */
export function Shell() {
  const { run, chipsFor, intro } = useMemo(() => {
    const env = fixtureEnv()
    const ephemeral = ROOMS.filter((room) => room.ephemeral).map((room) => room.slug)
    const commons = ROOMS.find((room) => room.slug === 'commons')!

    // §3.10 — you start in commons, and it sits in the room list as a peer.
    const lines: Line[] = [
      { text: 'thewall.sh', tone: 'accent' },
      { text: 'type look to see what’s around you, or tap a command below.', tone: 'faint' },
      { text: '' },
      ...renderRoom(commons),
    ]

    return {
      run: createRunner(env, ephemeral),
      chipsFor: createChipsFor(ephemeral),
      intro: lines,
    }
  }, [])

  return (
    <Terminal
      initialLines={intro}
      initialLocation={{ room: 'commons' }}
      run={run}
      chipsFor={chipsFor}
      name={null}
    />
  )
}
