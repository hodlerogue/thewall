'use client'

import { useEffect, useState } from 'react'
import { Terminal } from '@/components/Terminal'
import { createChipsFor, createRunner } from '@/lib/commands/run'
import { supabaseEnv } from '@/lib/data/supabaseEnv'
import { fixtureEnv, type Env } from '@/lib/shell/env'
import { renderRoom } from '@/lib/shell/render'
import { createClient, isConfigured } from '@/lib/supabase/client'
import type { Chip, Line, Location, Runner } from '@/lib/shell/types'

const DEFAULT_ROOM = 'commons'

interface Boot {
  run: Runner
  chipsFor: (location: Location) => readonly Chip[]
  lines: Line[]
  location: Location
}

/**
 * Loads what you see on arrival, then hands the Terminal a runner.
 *
 * Data comes from Supabase. Fixtures are available only behind an explicit
 * flag, for the mobile gate suite, which tests layout and has no business
 * depending on a database — there is deliberately no silent fallback, so a
 * missing project is reported rather than papered over.
 */
export function Shell() {
  const [boot, setBoot] = useState<Boot | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const useFixtures = process.env.NEXT_PUBLIC_USE_FIXTURES === '1'

      if (!useFixtures && !isConfigured()) {
        setFailure(
          'thewall needs a supabase project. copy .env.example to .env.local, fill in the url and anon key, then apply supabase/migrations and supabase/seed.sql.',
        )
        return
      }

      const env: Env = useFixtures ? fixtureEnv() : supabaseEnv(createClient())

      try {
        const rooms = await env.listRooms()
        const ephemeral = rooms.filter((room) => room.ephemeral).map((room) => room.slug)

        // §3.10 — you start in commons, and it sits in the list as a peer.
        const commons = await env.getRoom(DEFAULT_ROOM)

        if (cancelled) return
        setBoot({
          run: createRunner(env, ephemeral),
          chipsFor: createChipsFor(ephemeral),
          location: commons ? { room: commons.slug } : {},
          lines: [
            { text: 'thewall.sh', tone: 'accent' },
            { text: 'type look to see what’s around you, or tap a command below.', tone: 'faint' },
            { text: '' },
            ...(commons ? renderRoom(commons) : []),
          ],
        })
      } catch (error) {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error))
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (failure) {
    return (
      <div className="app">
        <div className="scrollback">
          <p className="line line-error">{failure}</p>
        </div>
      </div>
    )
  }

  if (!boot) {
    return (
      <div className="app">
        <div className="scrollback">
          <p className="line line-faint">…</p>
        </div>
      </div>
    )
  }

  return (
    <Terminal
      initialLines={boot.lines}
      initialLocation={boot.location}
      run={boot.run}
      chipsFor={boot.chipsFor}
      name={null}
    />
  )
}
