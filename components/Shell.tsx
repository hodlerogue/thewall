'use client'

import { useEffect, useState } from 'react'
import { Terminal } from '@/components/Terminal'
import { createChipsFor, createRunner } from '@/lib/commands/run'
import { createLive, type Live } from '@/lib/data/live'
import { supabaseEnv } from '@/lib/data/supabaseEnv'
import { httpSignupApi, supabaseWriter } from '@/lib/data/writer'
import { fixtureEnv, type Env } from '@/lib/shell/env'
import { describeError } from '@/lib/shell/errors'
import { renderPost, renderProfile, renderRoom, renderRoomList } from '@/lib/shell/render'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import { createClient, isConfigured } from '@/lib/supabase/client'
import { locationToPath, pathToLocation } from '@/lib/shell/types'
import type { Chip, Line, Location, Runner } from '@/lib/shell/types'

const DEFAULT_ROOM = 'commons'

interface Boot {
  run: Runner
  mailCount?: () => Promise<number>
  chipsFor: (location: Location) => readonly Chip[]
  lines: Line[]
  location: Location
  name: string | null
  subscribe?: Live['subscribe']
}

/**
 * Loads what you see on arrival, then hands the Terminal a runner.
 *
 * Data comes from Supabase. Fixtures are available only behind an explicit
 * flag, for the mobile gate suite, which tests layout and has no business
 * depending on a database — there is deliberately no silent fallback, so a
 * missing project is reported rather than papered over.
 */
export function Shell({ initialLocation = { room: DEFAULT_ROOM } }: { initialLocation?: Location }) {
  const [boot, setBoot] = useState<Boot | null>(null)
  const [failure, setFailure] = useState<Line[] | null>(null)

  // A Location is a fresh object on every render, so the path is what the
  // effect depends on — otherwise arriving anywhere would reload forever.
  const targetPath = locationToPath(initialLocation)

  useEffect(() => {
    const target = pathToLocation(targetPath)
    // Fetched once. Two identical listRooms() calls could also disagree if a
    // room's ephemeral flag changed between them.
    let rooms: Awaited<ReturnType<Env['listRooms']>> | undefined

    let cancelled = false

    async function load() {
      const useFixtures = process.env.NEXT_PUBLIC_USE_FIXTURES === '1'

      if (!useFixtures && !isConfigured()) {
        setFailure([
          { text: 'thewall needs a supabase project.', tone: 'error' },
          {
            text: 'set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then redeploy — they are baked in at build time.',
            tone: 'faint',
          },
        ])
        return
      }

      let env: Env
      let writer: Writer
      let signup: SignupApi
      let existingName: string | null = null
      let live: Live | undefined
      // Filled once the rooms are known; createLive reads it at event time.
      const ephemeralNames: string[] = []

      if (useFixtures) {
        env = fixtureEnv()
        writer = fixtureWriter()
        signup = fixtureSignup()
      } else {
        const client = createClient()
        // The Env needs the channel to answer `who`, and the channel is opened
        // by the Terminal as you move — so this is handed over before either
        // exists, and reads through it at call time.
        const opened = createLive(client, ephemeralNames)
        live = opened
        env = supabaseEnv(client, opened)
        writer = supabaseWriter(client)
        signup = httpSignupApi()

        // Someone returning through a magic link is already signed in.
        const { data: userData, error: userError } = await client.auth.getUser()
        // A missing session is the normal state here, not a failure — but a
        // failed profile read is, and silently demoting a returning user to
        // `guest` would ask them to sign up for a name they already own.
        if (!userError && userData.user) {
          const { data, error } = await client
            .from('profiles')
            .select('name')
            .eq('id', userData.user.id)
            .maybeSingle()
          if (error) throw error
          existingName = data?.name ?? null
        }

        rooms = await env.listRooms()
        ephemeralNames.push(
          ...rooms.filter((room) => room.ephemeral).map((room) => room.slug),
        )
      }

      const session = new Session(signup, writer, existingName)

      rooms ??= await env.listRooms()
      const ephemeral = rooms.filter((room) => room.ephemeral).map((room) => room.slug)

      // §3.4 — the URL is a location, so arriving at /music/12 puts you
      // inside post 12 exactly as `go 12` would have.
      const { lines, location } = await arriveAt(env, target, rooms)

      if (cancelled) return
      setBoot({
        run: createRunner(env, ephemeral, session),
        chipsFor: createChipsFor(ephemeral),
        location,
        name: existingName,
        subscribe: live?.subscribe,
        lines: [
          { text: 'thewall.social', tone: 'accent' },
          ...(useFixtures
            ? [{ text: 'demo — nothing you type here is saved.', tone: 'faint' as const }]
            : []),
          { text: 'type look to see what’s around you, or tap a command below.', tone: 'faint' },
          { text: '' },
          ...lines,
        ],
      })
    }

    // Every await above is inside load(), and this catch is what makes that
    // matter. Previously four of them ran before a try block and the promise
    // was floated with `void`, so the likeliest failure of all — an unapplied
    // schema, the one describeError has a purpose-built message for — left the
    // boot spinner on screen forever with no prompt and no way to retry.
    load().catch((error) => {
      if (!cancelled) setFailure(describeError(error))
    })

    return () => {
      cancelled = true
    }
  }, [targetPath])

  if (failure) {
    return (
      <div className="app">
        <div className="scrollback">
          {failure.map((line, i) => (
            <p key={i} className={`line line-${line.tone ?? 'error'}`}>
              {line.text}
            </p>
          ))}
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
      subscribe={boot.subscribe}
      mailCount={boot.mailCount}
    />
  )
}

/**
 * Renders whatever the URL pointed at. A room or post that isn't there is not
 * an error page — it says so in one line and leaves you at the lobby, which is
 * always somewhere real to be.
 */
async function arriveAt(
  env: Env,
  target: Location,
  rooms: Awaited<ReturnType<Env['listRooms']>>,
): Promise<{ lines: Line[]; location: Location }> {
  // A project with no rooms at all is not a wrong turn, it is an unfinished
  // setup — and saying "there's no room called commons" makes it sound like a
  // typo. §5 is the reason this is worth its own message: rooms that arrive
  // empty are the failure mode, so an empty project should say so outright.
  if (rooms.length === 0) {
    return {
      lines: [
        { text: 'this project has no rooms yet.', tone: 'error' },
        { text: 'the schema is there but nothing has been seeded — run scripts/db-deploy.sh', tone: 'faint' },
      ],
      location: {},
    }
  }

  // §3.4 — `thewall.social/~marisol` is the same value as the prompt path, so
  // the URL resolves to a person exactly as `go ~marisol` does.
  if (target.person !== undefined) {
    const profile = await env.getProfile(target.person)
    if (!profile) {
      return {
        lines: [
          { text: `there’s no one called ${target.person}.`, tone: 'error' },
          ...renderRoomList(rooms),
        ],
        location: {},
      }
    }
    return { lines: renderProfile(profile), location: { person: profile.name } }
  }

  if (target.room === undefined) {
    return { lines: renderRoomList(rooms), location: {} }
  }

  const room = await env.getRoom(target.room)
  if (!room) {
    return {
      lines: [
        { text: `there’s no room called ${target.room}.`, tone: 'error' },
        ...renderRoomList(rooms),
      ],
      location: {},
    }
  }

  if (target.postId === undefined) {
    return { lines: renderRoom(room), location: { room: room.slug } }
  }

  const post = await env.getPost(room.slug, target.postId)
  if (!post) {
    return {
      lines: [
        { text: `there’s no post ${target.postId} in ${room.slug}.`, tone: 'error' },
        ...renderRoom(room),
      ],
      location: { room: room.slug },
    }
  }

  return { lines: renderPost(post), location: { room: room.slug, postId: post.id } }
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
    async resend() {
      return { note: 'nothing to send — this is a demo.' }
    },
    async create(name: string) {
      // No account was made and no mail was sent. Say so — this build gets
      // deployed to public URLs, and people type real addresses into it.
      return {
        ok: true as const,
        name,
        note: 'nothing was sent — this is a demo, and your address wasn’t kept.',
      }
    },
  }
}
