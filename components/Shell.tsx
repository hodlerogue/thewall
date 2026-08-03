'use client'

import { useEffect, useState } from 'react'
import { Terminal } from '@/components/Terminal'
import { createChipsFor, createRunner } from '@/lib/commands/run'
import { createPresence } from '@/lib/data/presence'
import { supabaseEnv } from '@/lib/data/supabaseEnv'
import { httpSignupApi, supabaseWriter } from '@/lib/data/writer'
import { fixtureEnv, type Env } from '@/lib/shell/env'
import { renderRoom } from '@/lib/shell/render'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import { createClient, isConfigured } from '@/lib/supabase/client'
import type { Chip, Line, Location, Runner } from '@/lib/shell/types'

const DEFAULT_ROOM = 'commons'

interface Boot {
  run: Runner
  chipsFor: (location: Location) => readonly Chip[]
  lines: Line[]
  location: Location
  name: string | null
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

      let env: Env
      let writer: Writer
      let signup: SignupApi
      let existingName: string | null = null

      if (useFixtures) {
        env = fixtureEnv()
        writer = fixtureWriter()
        signup = fixtureSignup()
      } else {
        const client = createClient()
        const presence = createPresence(client)
        env = supabaseEnv(client, presence)
        writer = supabaseWriter(client)
        signup = httpSignupApi()

        // Someone returning through a magic link is already signed in.
        const {
          data: { user },
        } = await client.auth.getUser()
        if (user) {
          const { data } = await client.from('profiles').select('name').eq('id', user.id).maybeSingle()
          existingName = data?.name ?? null
        }

        await presence.enter(DEFAULT_ROOM, existingName)
      }

      const session = new Session(signup, writer, existingName)

      try {
        const rooms = await env.listRooms()
        const ephemeral = rooms.filter((room) => room.ephemeral).map((room) => room.slug)

        // §3.10 — you start in commons, and it sits in the list as a peer.
        const commons = await env.getRoom(DEFAULT_ROOM)

        if (cancelled) return
        setBoot({
          run: createRunner(env, ephemeral, session),
          chipsFor: createChipsFor(ephemeral),
          location: commons ? { room: commons.slug } : {},
          name: existingName,
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
      name={boot.name}
    />
  )
}

/**
 * Fixture-mode stand-ins, so the mobile gate can walk the whole signup flow
 * without a database. Nothing here runs when Supabase is configured.
 */
function fixtureWriter(): Writer {
  let next = 100
  return {
    async post() {
      return next++
    },
    async reply() {},
  }
}

function fixtureSignup(): SignupApi {
  const taken = new Set(['jameson', 'marisol', 'tuck', 'ren', 'dev'])
  return {
    async checkName(name: string) {
      const available = !taken.has(name)
      return {
        available,
        alternates: available ? [] : [`${name}_`, `${name}1`, `the${name}`],
      }
    },
    async create(name: string) {
      return { ok: true as const, name }
    },
  }
}
