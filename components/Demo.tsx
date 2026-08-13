'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Palette } from '@/components/Palette'
import { append, Scrollback, type Keyed } from '@/components/Scrollback'
import { createChipsFor, createRunner, echoOf } from '@/lib/commands/run'
import { arrivalLines } from '@/lib/data/live'
import {
  DEMO_INVITATION,
  DEMO_QUIET,
  DEMO_REPLIES,
  DEMO_REPLIES_ELSEWHERE,
  DEMO_SCRIPT,
  DEMO_TURNS,
} from '@/lib/marketing/landing'
import { answerAs, demoWorld, fixtureSignup, fixtureWriter, newestBy } from '@/lib/shell/demo'
import { fixtureEnv } from '@/lib/shell/env'
import { describeError } from '@/lib/shell/errors'
import { renderRoomList } from '@/lib/shell/render'
import { Session } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'
import { promptLabel } from '@/lib/shell/types'

/**
 * The product, running in the hero of the page that sells it.
 *
 * Deliberately **not** `components/Shell.tsx`. That component is built to be
 * the entire screen and behaves like it: it tracks `visualViewport` and writes
 * `--app-height` onto the document root, pushes a history entry on every move,
 * captures scroll, and registers a service worker. All of that is correct for
 * the site and wrong inside a page, so this is a small thing assembled from the
 * same parts — the real registry, the real session, the real renderer, the same
 * `.line` and `.chip` markup — with none of the machinery that owns a viewport.
 *
 * What it is not: a mock. Every line below came out of `createRunner`, so this
 * cannot show a command the site does not have or output the site would not
 * produce. That is the entire reason it is worth the code.
 */

/** How fast the demo types, in ms per character, and how long it waits. */
const PER_CHAR = 38
const BEFORE_RUN = 480
const BETWEEN = 1100

/**
 * How long somebody takes to answer you.
 *
 * Long enough to read as a person rather than a form validating, short enough
 * that nobody has scrolled away. Not random: the demo has to be the same demo
 * twice, or a screenshot in a bug report is not evidence of anything.
 */
const ANSWER_AFTER = 1600

export function Demo({ children }: { children?: React.ReactNode }) {
  /*
   * One world, built once.
   *
   * The circular reference between the writer and the session is the same one
   * `Shell` has and is fine for the same reason: `whoami` is only ever called
   * at write time, which is long after `session` is assigned.
   */
  const world = useMemo(() => {
    const { rooms, people } = demoWorld()
    const env = fixtureEnv(rooms, people)
    let session: Session
    const writer = fixtureWriter(rooms, () => session.name())
    session = new Session(fixtureSignup(people), writer, null)
    const ephemeral = rooms.filter((room) => room.ephemeral).map((room) => room.slug)
    return {
      rooms,
      people,
      env,
      session,
      run: createRunner(env, ephemeral, session),
      chipsFor: createChipsFor(ephemeral),
    }
  }, [])

  const [lines, setLines] = useState<Keyed[]>([])
  const [location, setLocation] = useState<Location>({})
  const [name, setName] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [played, setPlayed] = useState(false)
  const [pending, setPending] = useState(false)
  const [composing, setComposing] = useState<{ lines: number; chars: number } | null>(null)
  const [focused, setFocused] = useState(false)

  /*
   * Whether the visitor has taken it over.
   *
   * A ref as well as state because the auto-play loop is an async function that
   * checks between every character; reading the state there would give it the
   * value from the render it started in, and the script would keep typing over
   * somebody who had started using it.
   */
  const [taken, setTaken] = useState(false)
  const takenRef = useRef(false)
  // A ref rather than state, because two fast Enters land in the same tick.
  const inFlight = useRef(false)
  /*
   * The answering, which has to survive re-renders and stop on unmount.
   *
   * `turns` is how many people are left; `answered` is the last thing of yours
   * that got a reply, so saying two things in a row is answered twice and
   * running `look` in between is not answered at all.
   */
  const turns = useRef(0)
  const answered = useRef<string | null>(null)
  /*
   * Every answer in flight, not the latest one.
   *
   * This was a single timer that each new answer cleared, and it dropped
   * replies: say two things inside the delay and the first person never
   * speaks — while the turn it cost was already spent. Measured at four
   * sentences and two answers, with the closing line never printed at all,
   * which is the exact silence this whole thing exists to prevent.
   *
   * A set, cleared as a set on unmount. Two people answering at once is not a
   * conflict; it is a busy room, which is what the site does anyway.
   */
  const answering = useRef(new Set<ReturnType<typeof setTimeout>>())
  /** Answers that have actually landed — what decides the closing line. */
  const delivered = useRef(0)
  const paneRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  /*
   * The site's own `append` — cap, keys and `hints off` included.
   *
   * Not a local one. A demo that kept its own copy is what let every other
   * difference in here happen, and the setting in particular is the browser's
   * rather than the room's: somebody who turned the instructions off should not
   * have them handed back by a demonstration of the thing they turned them off
   * in.
   */
  const print = useCallback((incoming: readonly Line[]) => {
    setLines((current) => append(current, incoming))
  }, [])

  // The pane scrolls itself and never the page. `scrollIntoView` would drag the
  // whole document, which on a landing page means the hero yanking a reader
  // down as they arrive.
  useEffect(() => {
    const pane = paneRef.current
    if (pane) pane.scrollTop = pane.scrollHeight
  }, [lines])

  /**
   * Somebody answers you, a beat later.
   *
   * Without this the demo's last act is your own sentence landing in silence,
   * which is the one thing a social site cannot afford to demonstrate. It is
   * scripted — see the note in lib/marketing/landing.ts — so nothing reads what
   * you wrote and nothing leaves the browser.
   *
   * It goes through `answerAs`, so the reply is really in the room and `look`
   * shows it afterwards; and it prints through `arrivalLines`, which is what
   * the site itself prints when somebody speaks while you are standing there.
   * Same shape, same suppression rule, one function.
   */
  const answer = useCallback(
    (at: Location, name: string) => {
      const room = at.room
      if (room === undefined || turns.current <= 0) return

      const mine = newestBy(world.rooms, room, name)
      if (!mine) return
      // One answer per thing you said. `look` between two sentences is not a
      // sentence, and saying the same words twice is.
      const said = `${room}/${mine.postId}/${mine.body}`
      if (answered.current === said) return
      answered.current = said

      const pool = DEMO_REPLIES[room] ?? DEMO_REPLIES_ELSEWHERE
      const turn = DEMO_TURNS - turns.current
      const body = pool[turn % pool.length]
      // Anybody but you. The demo's signup pushed your name into this list.
      const speaker = world.people.map((person) => person.name).filter((n) => n !== name)
      const author = speaker[turn % speaker.length] ?? 'marisol'

      turns.current -= 1

      const timer = setTimeout(() => {
        answering.current.delete(timer)
        const landed = answerAs(world.rooms, room, author, body, mine.postId)
        if (!landed) return
        print([
          { text: '' },
          ...arrivalLines({
            author,
            mine: name,
            body,
            at: new Date().toISOString(),
            depth: landed.depth,
            address: landed.address,
          }),
        ])
        /*
         * Counted on delivery rather than on scheduling, so the closing line
         * follows the last person who actually spoke. Reading `turns` here was
         * the other half of the dropped-answer bug: a cancelled reply left the
         * counter at zero with nobody having said anything, so the line either
         * fired early or never.
         */
        delivered.current += 1
        if (delivered.current === DEMO_TURNS) {
          print([{ text: DEMO_QUIET, tone: 'faint', hint: true }])
        }
      }, ANSWER_AFTER)
      answering.current.add(timer)
    },
    [print, world],
  )

  // Nothing may fire into a component that is gone.
  useEffect(() => {
    const timers = answering.current
    return () => {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const perform = useCallback(
    async (text: string) => {
      // One at a time, as on the site: a second Enter used to start a second
      // command against the pre-move location, so outputs landed in completion
      // order rather than submission order.
      if (inFlight.current) return
      inFlight.current = true
      print([echoOf(text, promptLabel(name, location))])
      setPending(true)

      let result
      try {
        result = await world.run(text, location, { typed: true })
      } catch (error) {
        // A command that throws rendering nothing at all reads as a dead
        // prompt. Say what went wrong and hand the words back, which is what
        // the site does.
        print(describeError(error))
        setInput(text)
        return
      } finally {
        inFlight.current = false
        setPending(false)
      }

      print(result.lines)
      const now = result.location ?? location
      if (result.location) setLocation(result.location)
      if (result.identity !== undefined) setName(result.identity)
      if (result.retry) setInput(result.retry)
      setComposing(result.composing ?? null)
      setAsking(world.session.isAsking())

      /*
       * The room fills up the moment you have a name.
       *
       * Before that, `say` is a signup question and answering it is not a
       * contribution — so the people arrive when you do, and only then.
       */
      const who = world.session.name()
      if (who !== null) {
        if (turns.current === 0 && answered.current === null) turns.current = DEMO_TURNS
        answer(now, who)
      }
    },
    [answer, print, location, name, world],
  )

  /*
   * The opening frame, then the script.
   *
   * `look` is printed rather than typed: the page should not load onto an empty
   * prompt and make somebody wait to see what this is. Everything after it is
   * typed, because the typing is the demonstration — a person watching has to
   * see that words are what moves you.
   */
  useEffect(() => {
    let cancelled = false
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms)
      })
    const stopped = () => cancelled || takenRef.current

    async function play() {
      const { rooms, total } = await world.env.listRooms()
      if (stopped()) return
      print([
        { text: `${promptLabel(null, {})} look`, tone: 'echo' },
        { text: '' },
        ...renderRoomList(rooms, undefined, undefined, total),
      ])

      const motion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches

      let at: Location = {}
      for (const command of DEMO_SCRIPT) {
        await sleep(BETWEEN)
        if (stopped()) return

        if (motion) {
          setInput(command)
        } else {
          for (let i = 1; i <= command.length; i += 1) {
            if (stopped()) return
            setInput(command.slice(0, i))
            await sleep(PER_CHAR)
          }
        }

        await sleep(BEFORE_RUN)
        if (stopped()) return
        setInput('')

        /*
         * The script drives the runner directly rather than through `perform`.
         *
         * `perform` closes over `location`, and this loop moves between rooms
         * faster than a re-render can hand it a new one — so the second command
         * would be run from where the first started, and `go 12` would be
         * looking for post 12 in the lobby. The loop keeps its own.
         */
        const result = await world.run(command, at, { typed: true })
        if (stopped()) return
        print([echoOf(command, promptLabel(null, at)), ...result.lines])
        if (result.location) {
          at = result.location
          setLocation(result.location)
        }
      }

      if (!stopped()) setPlayed(true)
    }

    void play()
    return () => {
      cancelled = true
    }
    // Once, on mount. `world` is a useMemo with no dependencies and `print` is
    // stable; listing them would say this could re-run, and it must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Any of the three ways in. The script stops for good on the first one. */
  const takeOver = useCallback(() => {
    takenRef.current = true
    setTaken(true)
  }, [])

  const insert = useCallback(
    (text: string) => {
      takeOver()
      setInput(text)
      inputRef.current?.focus()
    },
    [takeOver],
  )

  const submit = useCallback(() => {
    takeOver()
    const text = input.trim()
    if (text === '') return
    setInput('')
    void perform(text)
  }, [input, perform, takeOver])

  const chips = world.chipsFor(location, name)

  return (
    /*
     * Tapping anywhere in here puts the caret back at the prompt, which is what
     * `.app` does on the site: the frame is mostly output, and after tapping a
     * line to read it there is nothing to aim at but a thin strip of nothing.
     * Ignored while text is selected, so copying still works.
     */
    <div
      className="demo"
      onMouseUp={() => {
        if (!window.getSelection()?.toString()) inputRef.current?.focus()
      }}
    >
      <div className="demo-bar" aria-hidden="true">
        <span className="demo-dot" />
        <span className="demo-dot" />
        <span className="demo-dot" />
        <span className="demo-title">thewall.social</span>
      </div>

      {/*
        * The scrollback, and what stands in for it until this component runs.
        *
        * `children` is the same listing rendered on the server, through the same
        * `Scrollback`, so the frame is never empty and never a spinner — the
        * page paints with the lobby already in it and this replaces it with the
        * live one on the frame it first appends to.
        */}
      <div className="demo-pane" ref={paneRef} data-testid="demo-pane">
        {lines.length === 0 ? children : <Scrollback lines={lines} onInsert={insert} />}
      </div>

      <div className="demo-composer">
        {/* The same second of nothing the site fills. Between Enter and the
            answer there is otherwise a prompt that visibly swallowed what you
            typed and printed no reply. */}
        {pending && (
          <p className="pending" data-testid="demo-pending">
            …
          </p>
        )}
        {composing && !pending && (
          <p className="composing">
            writing — {composing.lines} {composing.lines === 1 ? 'line' : 'lines'},{' '}
            {composing.chars}/{Session.LIMIT} · a dot ends it
          </p>
        )}
        {/*
          * Chips insert. They never execute — §3.6 and §9 make that the line
          * between a real interface and a terminal costume, and a page selling
          * this one is the last place to blur it. Enter runs things, here as
          * there; tapping a chip puts the caret in the prompt, which on a phone
          * is what raises the keyboard whose go key is the other half of it.
          *
          * Hidden while the session is asking something, because mid-question
          * anything typed is the answer rather than a command: a chip there
          * would submit the word `look` as somebody's name.
          */}
        {!asking && <Palette chips={chips} onInsert={insert} />}

        <form
          className="prompt-row"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <label
            className={`prompt-label${name === null ? ' prompt-label-guest' : ''}`}
            htmlFor="demo-prompt"
            data-testid="demo-label"
          >
            {promptLabel(name, location)}
          </label>
          {/* Where the caret would be, when there is not a real one — so the
              block sits exactly where your first character lands. */}
          {!focused && input === '' && <span className="caret" aria-hidden="true" />}
          <input
            id="demo-prompt"
            ref={inputRef}
            className="prompt-input"
            data-testid="demo-input"
            value={input}
            /* Never autofocused: on a phone that summons the keyboard over the
               page somebody has just arrived at. */
            onChange={(event) => {
              takeOver()
              setInput(event.target.value)
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            aria-label={`${promptLabel(name, location)} command`}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={Session.LIMIT + 48}
          />
        </form>
      </div>

      {/* Only once the script has finished, so it is an invitation rather than
          an interruption — and gone the moment it has been accepted. */}
      {played && !taken && <p className="demo-invitation">{DEMO_INVITATION}</p>}
    </div>
  )
}
