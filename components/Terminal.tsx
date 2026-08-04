'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Palette } from '@/components/Palette'
import { describeError } from '@/lib/shell/errors'
import type { Chip, Line, Location, Runner } from '@/lib/shell/types'
import { locationToPath, pathToLocation, promptLabel } from '@/lib/shell/types'

/**
 * What to say out loud about a result.
 *
 * Reading every line is worse than reading none — a room listing is forty
 * lines and a screen reader will queue all of them. The useful summary is the
 * first thing that came back, how much followed it, and where you ended up.
 */
function summarize(lines: readonly Line[], location: Location, name: string | null): string {
  const said = lines.map((line) => line.text.trim()).filter(Boolean)
  const where = promptLabel(name, location).replace(/\$$/, '')

  if (said.length === 0) return where
  if (said.length === 1) return `${said[0]}. ${where}`
  return `${said[0]}, and ${said.length - 1} more lines. ${where}`
}

export function Terminal({
  initialLines,
  initialLocation,
  run,
  chipsFor,
  name: initialName = null,
  subscribe,
  mailCount,
  initialMail = 0,
}: {
  initialLines: readonly Line[]
  initialLocation: Location
  run: Runner
  chipsFor: (location: Location) => readonly Chip[]
  name?: string | null
  /**
   * Who is here and what they say, for wherever you are standing. Absent in
   * fixtures mode. Takes the name because presence has to say who you are, and
   * because arrivals are filtered by it — you saw your own words already.
   */
  subscribe?: (
    location: Location,
    name: string | null,
    append: (lines: Line[]) => void,
  ) => () => void
  /** §4.1 — polled, because the lean is pull-only: no push, no email. */
  mailCount?: () => Promise<number>
  initialMail?: number
}) {
  const [lines, setLines] = useState<Line[]>([...initialLines])
  const [location, setLocation] = useState<Location>(initialLocation)
  const [name, setName] = useState<string | null>(initialName)
  const [input, setInput] = useState('')

  const [pending, setPending] = useState(false)
  const [mail, setMail] = useState(initialMail)
  const [announcement, setAnnouncement] = useState('')

  const scrollbackRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // A ref rather than the state, because `submit` must see the current value
  // synchronously — two Enters land in the same tick.
  const inFlight = useRef(false)

  /*
   * §4.4 — the reason this phase exists.
   *
   * On mobile the keyboard shrinks the *visual* viewport without touching the
   * layout viewport, so `100vh` (and often `100dvh`) leaves the prompt stranded
   * underneath it. Tracking visualViewport directly is the only reliable fix:
   * height keeps the composer on screen, offsetTop undoes the shift iOS applies
   * when it scrolls the layout viewport to reveal the focused field.
   */
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const sync = () => {
      const root = document.documentElement
      root.style.setProperty('--app-height', `${vv.height}px`)
      root.style.setProperty('--app-offset', `${vv.offsetTop}px`)
    }

    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
    }
  }, [])

  // New output is the thing you want to read, so it wins over scroll position.
  useEffect(() => {
    const el = scrollbackRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const insert = useCallback((text: string) => {
    setInput(text)
    const el = inputRef.current
    if (!el) return
    el.focus()
    // Cursor waiting at the end — the chip handed you a start, not an answer.
    requestAnimationFrame(() => {
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }, [])

  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (text === '') return

      // One at a time. Every command is a network round trip, and a second
      // Enter used to start a second command against the *pre-move* location:
      // outputs then landed in completion order rather than submission order,
      // and the prompt label, the URL and the last thing printed could all
      // disagree. Pressing Enter twice usually means "did that work?", which
      // the pending line below now answers.
      if (inFlight.current) return
      inFlight.current = true
      setPending(true)

      const echo: Line = { text: `${promptLabel(name, location)} ${text}`, tone: 'echo' }
      setInput('')
      setLines((prev) => [...prev, echo])

      let result
      try {
        result = await run(text, location)
      } catch (error) {
        // A command that throws used to render nothing at all, which reads as
        // a dead prompt. Whatever went wrong, say it and stay usable — and
        // hand back what they typed, since it plainly did not happen.
        const failure = describeError(error)
        setLines((prev) => [...prev, ...failure])
        setAnnouncement(failure.map((line) => line.text).join('. '))
        setInput(text)
        return
      } finally {
        inFlight.current = false
        setPending(false)
      }

      setLines((prev) => [...prev, ...result.lines])
      setAnnouncement(summarize(result.lines, result.location ?? location, name))

      if (result.location) {
        setLocation(result.location)
        // §3.4 — the prompt path and the URL are the same value, so moving
        // updates the address bar. pushState rather than a router navigation:
        // this is the same page, and a navigation would throw away scrollback.
        const path = locationToPath(result.location)
        if (path !== window.location.pathname) {
          window.history.pushState({}, '', path)
        }
      }

      // §3.9 — the prompt stops saying `guest` the moment there is a name.
      if (result.identity !== undefined) setName(result.identity)

      // Words that did not send go back where they can be sent again.
      if (result.retry) setInput(result.retry)

      // §4.1 — reading your mail is what clears it.
      if (result.mail !== undefined) setMail(result.mail)
    },
    [location, name, run],
  )

  // Back and forward are navigation too, so they move you the same way `go`
  // and `leave` do, and print where you landed.
  useEffect(() => {
    const onPop = async () => {
      const target = pathToLocation(window.location.pathname)
      setLocation(target)
      try {
        const result = await run('look', target, { typed: false })
        setLines((prev) => [...prev, { text: '', tone: 'faint' }, ...result.lines])
      } catch (error) {
        setLines((prev) => [...prev, ...describeError(error)])
      }
    }

    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [run])

  /*
   * §4.1 — "status bar shows the count persistently… Pull-only, no push, no
   * email." So it is polled rather than pushed, and only while you have a name
   * to receive anything under. A minute is well inside the patience of someone
   * who is already looking at the page, and it costs one small query.
   */
  useEffect(() => {
    if (!mailCount || name === null) return

    let stopped = false
    const check = () => {
      void mailCount()
        .then((count) => {
          if (!stopped) setMail(count)
        })
        .catch(() => {
          // A count that will not load is not worth interrupting anyone over.
        })
    }

    check()
    const timer = setInterval(check, 60_000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [mailCount, name])

  // Where you are standing, as a subscription. Re-opened on every move and on
  // signing up: "here" changes with you, and so does who you are when you get
  // there. Wiring this once at boot is why `who` used to answer with the room
  // you first landed in and why you never appeared in any room you walked to.
  useEffect(() => {
    if (!subscribe) return
    return subscribe(location, name, (incoming) => {
      setLines((prev) => [...prev, { text: '' }, ...incoming])
    })
  }, [subscribe, location.room, location.postId, name])

  const label = promptLabel(name, location)

  return (
    <div className="app">
      {/*
        * The scrollback itself is not a live region. Appending twenty lines to
        * one makes a screen reader queue twenty announcements, and the echo
        * line would be read back to you as well. This carries a summary
        * instead: what came back, and where you now are.
        */}
      <p className="announcer" aria-live="polite" aria-atomic="true" data-testid="announcer">
        {announcement}
      </p>

      <div
        className="scrollback"
        ref={scrollbackRef}
        data-testid="scrollback"
        /* The whole session lives in here and it is the only way to reach
           anything that scrolled off, so it has to be focusable — otherwise
           keyboard-only users cannot read their own history (WCAG 2.1.1). */
        tabIndex={0}
        role="log"
        aria-label="what has happened so far"
      >
        {lines.map((line, i) => (
          <p
            key={i}
            className={[
              'line',
              line.tone && line.tone !== 'default' ? `line-${line.tone}` : '',
              line.depth ? `depth-${line.depth}` : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {line.text === '' ? ' ' : line.text}
          </p>
        ))}
      </div>

      <div className="composer">
        {/* Between Enter and the answer there used to be nothing at all — on a
            phone that is up to a second of a prompt that visibly swallowed
            your input and printed no reply. */}
        {pending && (
          <p className="pending" data-testid="pending">
            …
          </p>
        )}
        {/* The Unix precedent §4.1 cites is the login line. This is the same
            idea, kept where you are already looking rather than shown once and
            gone. */}
        {mail > 0 && !pending && (
          <p className="mail" data-testid="mail">
            you have {mail} {mail === 1 ? 'reply' : 'replies'} waiting — type mail
          </p>
        )}
        <Palette chips={chipsFor(location)} onInsert={insert} />
        <form
          className="prompt-row"
          onSubmit={(event) => {
            event.preventDefault()
            void submit(input)
          }}
        >
          <label
            className={`prompt-label${name === null ? ' prompt-label-guest' : ''}`}
            htmlFor="prompt"
            data-testid="prompt-label"
          >
            {label}
          </label>
          <input
            id="prompt"
            ref={inputRef}
            className="prompt-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            data-testid="prompt-input"
            /* The visible label is the location, and §3.1's whole claim is
               that a terminal answers "where am I" for free. A bare
               aria-label="command" overrode it, so that was true for sighted
               users and false for everyone else — and it fails WCAG 2.5.3,
               which wants the visible text inside the accessible name. */
            aria-label={`${label} command`}
            /* The database caps a body at 2000. Without this the words are
               typed, sent, refused, and gone — which is the failure §3.9
               exists to prevent. `say ` is the longest prefix. */
            maxLength={2010}
          />
        </form>
      </div>
    </div>
  )
}
