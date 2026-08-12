'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Palette } from '@/components/Palette'
import { createChipsFor, createRunner, echoOf } from '@/lib/commands/run'
import { DEMO_INVITATION, DEMO_SCRIPT } from '@/lib/marketing/landing'
import { demoWorld, fixtureSignup, fixtureWriter } from '@/lib/shell/demo'
import { fixtureEnv } from '@/lib/shell/env'
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

let nextKey = 0
type Keyed = Line & { key: number }
const withKey = (line: Line): Keyed => ({ ...line, key: (nextKey += 1) })

/** Enough to see where you have been, and short of a memory conversation. */
const CAP = 120

/** How fast the demo types, in ms per character, and how long it waits. */
const PER_CHAR = 38
const BEFORE_RUN = 480
const BETWEEN = 1100

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
  const paneRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const append = useCallback((incoming: readonly Line[]) => {
    setLines((current) => [...current, ...incoming.map(withKey)].slice(-CAP))
  }, [])

  // The pane scrolls itself and never the page. `scrollIntoView` would drag the
  // whole document, which on a landing page means the hero yanking a reader
  // down as they arrive.
  useEffect(() => {
    const pane = paneRef.current
    if (pane) pane.scrollTop = pane.scrollHeight
  }, [lines])

  const perform = useCallback(
    async (text: string) => {
      const result = await world.run(text, location, { typed: true })
      append([echoOf(text, promptLabel(name, location)), ...result.lines, { text: '' }])
      if (result.location) setLocation(result.location)
      if (result.identity !== undefined) setName(result.identity)
      setAsking(world.session.isAsking())
    },
    [append, location, name, world],
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
      append([
        { text: `${promptLabel(null, {})} look`, tone: 'echo' },
        { text: '' },
        ...renderRoomList(rooms, undefined, undefined, total),
        { text: '' },
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
        append([echoOf(command, promptLabel(null, at)), ...result.lines, { text: '' }])
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
    // Once, on mount. `world` is a useMemo with no dependencies and `append` is
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
    <div className="demo">
      <div className="demo-bar" aria-hidden="true">
        <span className="demo-dot" />
        <span className="demo-dot" />
        <span className="demo-dot" />
        <span className="demo-title">thewall.social</span>
      </div>

      {/*
        * The scrollback, and what stands in for it until this component runs.
        *
        * `children` is the same listing rendered on the server, so the frame is
        * never empty and never a spinner — the page paints with the lobby
        * already in it, and this replaces it with the live one on the same
        * frame it appends to.
        */}
      <div className="demo-pane" ref={paneRef} data-testid="demo-pane">
        {lines.length === 0 ? (
          children
        ) : (
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
                {line.tap ? (
                  <>
                    <span className="line-accent">{line.tap.token}</span>
                    {line.text.slice(line.tap.token.length)}
                  </>
                ) : (
                  line.text
                )}
              </p>
            ))}
          </>
        )}
      </div>

      <div className="demo-composer">
        {/*
          * Chips insert. They never execute — §3.6 and §9 make that the line
          * between a real interface and a terminal costume, and a page selling
          * this one is the last place to blur it. The ↵ beside the prompt is
          * what runs things, and two taps is the demonstration.
          *
          * Hidden while the session is asking something, because mid-question
          * anything typed is the answer rather than a command: a chip there
          * would submit the word `look` as somebody's name.
          */}
        {!asking && <Palette chips={chips} onInsert={insert} />}

        <div className="prompt-row">
          <span className="prompt-label" data-testid="demo-label">
            {promptLabel(name, location)}
          </span>
          <input
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
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
            aria-label="try a command"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={200}
          />
          <button
            type="button"
            className="demo-enter"
            onClick={submit}
            aria-label="run it"
            data-testid="demo-enter"
          >
            ↵
          </button>
        </div>
      </div>

      {/* Only once the script has finished, so it is an invitation rather than
          an interruption — and gone the moment it has been accepted. */}
      {played && !taken && <p className="demo-invitation">{DEMO_INVITATION}</p>}
    </div>
  )
}
