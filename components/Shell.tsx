'use client'

import { useEffect, useState } from 'react'
import { Terminal } from '@/components/Terminal'
import { createChipsFor, createRunner } from '@/lib/commands/run'
import { createLive, type Live } from '@/lib/data/live'
import { supabaseEnv } from '@/lib/data/supabaseEnv'
import { httpSignupApi, supabaseWriter } from '@/lib/data/writer'
import { fixtureEnv, type Env, type FixturePerson } from '@/lib/shell/env'
import { startArrivalReads, type ArrivalReads } from '@/lib/shell/boot'
import { PEOPLE } from '@/lib/shell/fixtures'
import { describeError } from '@/lib/shell/errors'
import { shouldSuggest, suggestion, watchForInstall } from '@/lib/pwa/install'
import { renderFeed, renderPost, renderProfile, renderRoom, renderRoomList } from '@/lib/shell/render'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import { createClient, isConfigured } from '@/lib/supabase/client'
import { locationToPath, pathToLocation } from '@/lib/shell/types'
import type { Chip, Line, Location, Runner } from '@/lib/shell/types'

const DEFAULT_ROOM = 'commons'

/**
 * What the Terminal needs to exist.
 *
 * The two fields that are absent in fixtures mode are typed as
 * `T | undefined` rather than `field?: T`, which is not a stylistic choice: an
 * optional property may be *omitted*, and omitting one is exactly how §4.1's
 * mail count shipped dead. `mailCount` was declared here, threaded into
 * `Terminal`, given a polling effect and a status line — and never once set, so
 * the effect returned immediately every time. Requiring the key means the
 * compiler asks about it.
 */
interface Boot {
  run: Runner
  mailCount: (() => Promise<number>) | undefined
  initialMail: number
  chipsFor: (location: Location, name: string | null) => readonly Chip[]
  lines: Line[]
  location: Location
  name: string | null
  subscribe: Live['subscribe'] | undefined
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

  /*
   * Two things that have to happen once per page, not once per navigation.
   *
   * The worker is registered rather than bundled because it has to be served
   * from the origin root to control the whole scope, and it caches nothing —
   * see public/sw.js for why that is deliberate on a site whose every screen is
   * either live or a few hundred bytes.
   *
   * `beforeinstallprompt` has to be listened for before the browser fires it,
   * which is usually seconds after load and long before anybody would want to
   * be asked. Catching it early and offering it late is the whole arrangement.
   */
  useEffect(() => {
    watchForInstall()
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registration fails on http, in private windows, and wherever it is
        // switched off. None of that stops the site working, so none of it is
        // worth a line on screen.
      })
    }
  }, [])

  useEffect(() => {
    const target = pathToLocation(targetPath)
    let cancelled = false

    async function load() {
      const useFixtures = process.env.NEXT_PUBLIC_USE_FIXTURES === '1'

      // Read before anything can branch, because reading it also strips it
      // from the address — so it has to happen exactly once, on every path.
      const keyLines = takeKeyOutcome()

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
      let client: ReturnType<typeof createClient> | undefined
      // Filled once the rooms are known; createLive reads it at event time.
      const ephemeralNames: string[] = []

      if (useFixtures) {
        // Whoever signs up in the demo gets a page, because their own page is
        // the only place a wall can be tried. The real Env gets this from the
        // profiles table; here it is an array the fake signup pushes to and
        // fixtureEnv reads at call time.
        const demoPeople: FixturePerson[] = [...PEOPLE]
        env = fixtureEnv(undefined, demoPeople)
        writer = fixtureWriter()
        signup = fixtureSignup(demoPeople)
      } else {
        client = createClient()
        // The Env needs the channel to answer `who`, and the channel is opened
        // by the Terminal as you move — so this is handed over before either
        // exists, and reads through it at call time.
        const opened = createLive(client, ephemeralNames)
        live = opened
        env = supabaseEnv(client, opened)
        writer = supabaseWriter(client)
        signup = httpSignupApi()
      }

      /*
       * Started the moment there is an Env, and deliberately before the session
       * lookup rather than after it.
       *
       * That ordering is the whole point. `getUser` and the profile read are
       * the one genuine dependency in boot — the second needs the id from the
       * first — and the rooms have nothing to do with either. Started here they
       * run *while* the session is being checked instead of behind it.
       *
       * One call for both modes, not one inside each branch. The demo taking a
       * shorter path than the site is how a listing that paged in production
       * and not in fixtures hid a truncation bug for weeks; a *timing* property
       * that only holds on one of them would be the same mistake, and quieter.
       *
       * See lib/shell/boot.ts for why this is a function with a test.
       */
      const reads = startArrivalReads(env, target)

      // Someone returning through a magic link is already signed in.
      if (client) {
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
      }

      const session = new Session(signup, writer, existingName)

      // Awaited once, from the single promise `startArrivalReads` made. Two
      // separate listRooms() calls could also disagree with each other if a
      // room's ephemeral flag changed between them.
      const lobby = await reads.rooms
      const rooms = lobby.rooms
      const ephemeral = rooms.filter((room) => room.ephemeral).map((room) => room.slug)
      // `createLive` was handed this array before the rooms were known and
      // reads it at event time, so filling it here is what makes commons
      // recognisable as ephemeral to a message that arrives later.
      ephemeralNames.push(...ephemeral)

      /*
       * §3.4 — the URL is a location, so arriving at /music/12 puts you inside
       * post 12 exactly as `go 12` would have.
       *
       * §4.1 — the mail count is read here as well as polled, so somebody
       * arriving to three replies sees that on the first paint rather than up
       * to a minute later. Only for someone with a name: a guest has no mail by
       * definition, and asking would be a round trip to learn zero.
       *
       * Together, because they are unrelated. The count used to wait for the
       * room to finish rendering, which bought nothing and cost a whole round
       * trip on the one screen nobody is looking at yet.
       */
      const [arrival, initialMail] = await Promise.all([
        arriveAt(env, target, lobby, reads.room),
        existingName === null ? Promise.resolve(0) : env.mailCount().catch(() => 0),
      ])
      const { lines, location } = arrival

      if (cancelled) return
      setBoot({
        run: createRunner(env, ephemeral, session),
        chipsFor: createChipsFor(ephemeral),
        // Always handed over, never gated on who is here yet: §3.9 means most
        // people get their name *during* the session, and a poller wired only
        // for those who arrived signed in would stay dead for exactly the
        // person who just made an account. Terminal already declines to poll
        // while the name is null, which is the check that belongs there.
        mailCount: () => env.mailCount(),
        initialMail,
        location,
        name: existingName,
        subscribe: live?.subscribe,
        lines: [
          { text: 'thewall.social', tone: 'accent' },
          ...(useFixtures
            ? [{ text: 'demo — nothing you type here is saved.', tone: 'faint' as const }]
            : []),
          { text: 'type look to see what’s around you, or tap a command below.', tone: 'faint' },
          /*
           * One more line, and only for somebody who has not been here before.
           *
           * Landing on a command prompt on a social site raises a question that
           * neither `help` nor `what` answers — they say what you can type, not
           * what this is. Somebody with a name has already worked it out and
           * does not need telling every load.
           */
          ...(existingName === null
            ? [{ text: 'new here? type about.', tone: 'faint' as const }]
            : []),
          { text: '' },
          ...keyLines,
          /*
           * At most one line, once ever, and only to somebody who already has a
           * name — which means they either came back, or they have just been
           * through signup and decided this was worth an account.
           *
           * A first-time reader thirty seconds in gets nothing. Suggesting it
           * then is the banner that `beforeinstallprompt` is suppressed to
           * avoid, moved into the scrollback and no less of an interruption for
           * being made of text.
           */
          ...(shouldSuggest(existingName !== null) ? [...suggestion(), { text: '' }] : []),
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
      initialMail={boot.initialMail}
    />
  )
}

/**
 * What happened to the magic link, said out loud.
 *
 * Following a key used to produce no feedback whatsoever — you clicked, you
 * landed, and nothing on the page acknowledged it. When the marking also failed
 * that became unrecoverable: the gate stayed shut, the message still said to
 * click the link, and clicking it again did exactly the same nothing.
 *
 * Read once and stripped from the address, because §3.4 makes the path the
 * prompt's location and a query string is not part of that.
 */
function takeKeyOutcome(): Line[] {
  if (typeof window === 'undefined') return []

  const params = new URLSearchParams(window.location.search)
  const outcome = params.get('key')
  if (outcome !== 'ok' && outcome !== 'failed' && outcome !== 'expired') return []

  params.delete('key')
  const query = params.toString()
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)

  if (outcome === 'ok') {
    return [
      { text: 'your key worked — you’re verified.', tone: 'accent' },
      { text: 'say what you like, as often as you like.', tone: 'faint' },
      { text: '' },
    ]
  }

  if (outcome === 'expired') {
    /*
     * `login <name>`, not `resend` — because the commonest way to arrive here
     * is in a browser with no session, and `resend` reads the address off
     * `auth.getUser()`. With nothing to read it answers "say something first
     * and i'll ask who you are", saying something asks for a name, and your own
     * name comes back taken. Three steps to a dead end, from the one line of
     * advice on the screen.
     *
     * That is exactly the trap `/api/login` was built to end, still reachable
     * through this message. And it breaks the rule written down for it: a
     * suggested fix has to be one the site will accept.
     *
     * The route here is walked more than it looks. Gmail's app opens links in
     * its own browser, which has its own cookies — so the key is spent over
     * there, and the same link opened in Safari afterwards lands on this line
     * with no session behind it. `login <name>` is the one instruction that
     * works whether or not there is one; signed in already, it says so and
     * costs nothing.
     */
    return [
      { text: 'that key had already been used, or it expired.', tone: 'error' },
      { text: 'type login and your name — login ryan — and i’ll send another.', tone: 'faint' },
      { text: '' },
    ]
  }

  return [
    { text: 'you followed the link, but i couldn’t finish marking you verified.', tone: 'error' },
    // The person's move first, the operator's second. Somebody stuck here can
    // do something about it, and whoever runs this can tell what to look at.
    { text: 'type resend and try once more. if it happens again the database is behind.', tone: 'faint' },
    { text: '' },
  ]
}

/**
 * Renders whatever the URL pointed at. A room or post that isn't there is not
 * an error page — it says so in one line and leaves you at the lobby, which is
 * always somewhere real to be.
 */
async function arriveAt(
  env: Env,
  target: Location,
  lobby: Awaited<ReturnType<Env['listRooms']>>,
  /**
   * The room, if boot already started fetching it.
   *
   * Passed rather than looked up so the fetch can overlap the room list. Absent
   * is not an error — fixtures mode does not prefetch, and neither do the
   * branches below that never reach `getRoom`.
   */
  prefetched?: ArrivalReads['room'],
): Promise<{ lines: Line[]; location: Location }> {
  // A project with no rooms at all is not a wrong turn, it is an unfinished
  // setup — and saying "there's no room called commons" makes it sound like a
  // typo. §5 is the reason this is worth its own message: rooms that arrive
  // empty are the failure mode, so an empty project should say so outright.
  const { rooms, total } = lobby

  if (total === 0) {
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
          ...renderRoomList(rooms, undefined, undefined, total),
        ],
        location: {},
      }
    }
    return { lines: renderProfile(profile), location: { person: profile.name } }
  }

  if (target.room === undefined) {
    return { lines: renderRoomList(rooms, undefined, undefined, total), location: {} }
  }

  /*
   * `feed` is a room that holds nothing, so the ordinary path renders it as an
   * empty one — "nothing here yet, say something and it will be the first
   * thing", which is wrong twice over: it is not empty, and saying something
   * there does not go there.
   *
   * `go feed` was special-cased and this was not, so the bug lived on exactly
   * one route: the URL, which is the one somebody arrives at from a link.
   */
  if (target.room === 'feed') {
    return { lines: renderFeed(await env.readFeed()), location: { room: 'feed' } }
  }

  const room = await (prefetched ?? env.getRoom(target.room))
  if (!room) {
    return {
      lines: [
        { text: `there’s no room called ${target.room}.`, tone: 'error' },
        ...renderRoomList(rooms, undefined, undefined, total),
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
  const taken = new Set(['jameson', 'marisol', 'tuck', 'ren', 'dev'])
  return {
    async post() {
      return next++
    },
    async reply() {},
    async rename(name: string) {
      if (taken.has(name)) return { ok: false as const, reason: `${name} is taken` }
      return { ok: true as const, name }
    },
  }
}

/**
 * Not a secret, and not meant to be. See `login` below for why the demo hands
 * this over rather than pretending mail exists.
 */
const DEMO_CODE = '123456'

function fixtureSignup(people: FixturePerson[]): SignupApi {
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
    async logout() {
      // Nothing to end — the demo never had a session. Answering `ok` is the
      // truth of it: after this you are a guest here, same as the real site.
      return { ok: true as const }
    },
    async login(name: string) {
      // Both branches, not a single cheerful one. `login` is reachable from
      // `help` here as it is anywhere, so the fixture build is where somebody
      // finds out what it does — and "no one is called that" is half of what
      // it does.
      if (!taken.has(name) && !people.some((person) => person.name === name)) {
        return {
          ok: false as const,
          reason: `no one here is called ${name}. if you’ve not been here before, say something and i’ll set you up.`,
        }
      }
      /*
       * The demo asks for a code and tells you what it is.
       *
       * The alternative — say "nothing was sent" and stop — leaves the whole
       * code flow unwalkable in the demo build and therefore untested by the
       * phone suite, which is §8's kill condition. That is the fixture-is-a-
       * different-shape trap this codebase keeps falling into: a listing that
       * paged on the real site and not in fixtures hid a truncation bug for
       * weeks.
       *
       * Saying the code out loud is honest rather than cute. Nothing was
       * emailed and nothing was kept; what is being demonstrated is the shape
       * of the exchange, and a demo that hands you the answer is obviously a
       * demo.
       */
      return {
        ok: true as const,
        name,
        codeSent: true,
        note: `nothing was emailed — this is a demo. on the real site a key would be in that account’s inbox; here the code is ${DEMO_CODE}.`,
      }
    },

    async loginCode(name: string, code: string) {
      if (code.trim().toLowerCase().replace(/[\s-]/g, '') !== DEMO_CODE) {
        return {
          ok: false as const,
          reason: `that code didn’t work. in this demo it is ${DEMO_CODE}.`,
        }
      }
      return { ok: true as const, name }
    },
    async create(name: string) {
      // Nothing is stored anywhere, but the demo does have to be able to show
      // you `~yourname` a second later, or `say` on your own wall has nowhere
      // to land and the feature cannot be tried at all.
      people.push({ name, joinedAt: new Date(), verified: false })
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
