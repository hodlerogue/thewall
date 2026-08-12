'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Palette } from '@/components/Palette'
import { append, MAX_LINES, Scrollback, type Keyed } from '@/components/Scrollback'
import { echoOf } from '@/lib/commands/run'
import { withOneMoreReply } from '@/lib/shell/render'
import { describeError } from '@/lib/shell/errors'
import type { Chip, Line, Location, Runner } from '@/lib/shell/types'
import { locationToPath, pathToLocation, promptLabel } from '@/lib/shell/types'
import { Session } from '@/lib/shell/session'

/**
 * A stable identity per line.
 *
 * Index keys were correct only while the array was append-only. Capping it
 * makes them wrong — every line's tone and indent would shift up by one on
 * each trim — so the cap and the keys have to change together.
 */



/**
 * Tab completion, over the verbs that are valid where you are standing.
 *
 * Deliberately narrow: it completes the verb, not its argument. Room names are
 * the other obvious candidate, but they need a round trip, and a completion
 * that pauses is worse than one that is not offered.
 */
function complete(input: string, chips: readonly Chip[]): string | null {
  const typed = input.trimStart()
  if (typed === '' || typed.includes(' ')) return null

  const matches = chips.map((chip) => chip.verb).filter((verb) => verb.startsWith(typed.toLowerCase()))
  if (matches.length !== 1) return null

  const chip = chips.find((c) => c.verb === matches[0])!
  return chip.insert
}

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
  chipsFor: (location: Location, name: string | null) => readonly Chip[]
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
  const [lines, setLines] = useState<Keyed[]>(() => append([], initialLines))
  const [location, setLocation] = useState<Location>(initialLocation)
  const [name, setName] = useState<string | null>(initialName)
  const [input, setInput] = useState('')

  const [pending, setPending] = useState(false)
  const [mail, setMail] = useState(initialMail)
  // Null unless a longer post is being written. Set from every result rather
  // than only when it changes — see RunResult.composing for why that matters.
  const [composing, setComposing] = useState<{ lines: number; chars: number } | null>(null)
  /*
   * The same fact, readable from a callback that must not be rebuilt.
   *
   * `aim` is handed to a memoised Scrollback, so a dependency on `composing`
   * would make a new function on every keystroke of a draft and re-render every
   * line printed. A ref written beside the state costs nothing and keeps both
   * properties.
   */
  const composingRef = useRef<{ lines: number; chars: number } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  /*
   * Whether the prompt holds the caret.
   *
   * Only ever used to decide whether to draw one ourselves. Nothing on screen
   * said "type here": the input is transparent, borderless and empty, and a
   * browser draws no caret in a field it has not been given. On a phone, where
   * there is no cursor of any kind until you tap, the answer to "where do I
   * type" was a thin strip of nothing to the right of the label.
   */
  const [focused, setFocused] = useState(false)

  const scrollbackRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // A ref rather than the state, because `submit` must see the current value
  // synchronously — two Enters land in the same tick.
  const inFlight = useRef(false)
  const pinnedToBottom = useRef(true)

  // Anything typed, so Up can walk back through it.
  const history = useRef<string[]>([])
  const historyAt = useRef<number | null>(null)

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

    const root = document.documentElement
    let lastHeight = -1
    let lastOffset = -1

    const sync = () => {
      /*
       * Rounded, and only written when it actually changed.
       *
       * These fire on every frame of a scroll, and both values arrive as
       * fractions that wobble by a fraction of a pixel as the gesture moves.
       * Writing a custom property forces a style recalculation of everything
       * under it, so the old version relaid out the whole shell dozens of
       * times a second while somebody was reading — which is how the text
       * ends up appearing to jump around and slide under things.
       */
      const height = Math.round(vv.height)
      const offset = Math.round(vv.offsetTop)
      if (height === lastHeight && offset === lastOffset) return

      lastHeight = height
      lastOffset = offset
      root.style.setProperty('--app-height', `${height}px`)
      root.style.setProperty('--app-offset', `${offset}px`)

      /*
       * Follow the bottom through the resize, which is the actual bug behind
       * "I tapped to type and the prompt is on top of the text".
       *
       * Nothing was wrong with the layout: the shell shrank to make room for
       * the keyboard and the scrollback kept the same scrollTop, so the line
       * somebody had been reading was now underneath the composer, bisected by
       * its top edge. It looks exactly like an element drawn in the wrong
       * place, and it is a scroll position that nobody updated.
       *
       * On the next frame, because the height above has to be applied before
       * scrollHeight means anything.
       */
      requestAnimationFrame(() => {
        const el = scrollbackRef.current
        if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight
      })
    }

    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)

    /*
     * The keyboard closing does not always announce itself. iOS in particular
     * can dismiss it without a resize on the visual viewport, which leaves the
     * shell stuck at keyboard height — a band of bare background under the
     * composer where the conversation should be. Blur is the other signal that
     * it went away, and re-measuring on the next frame costs nothing.
     */
    const remeasure = () => requestAnimationFrame(sync)
    window.addEventListener('focusout', remeasure)
    window.addEventListener('orientationchange', remeasure)

    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
      window.removeEventListener('focusout', remeasure)
      window.removeEventListener('orientationchange', remeasure)
    }
  }, [])

  /*
   * Follow the bottom only if you were already there.
   *
   * Your own command output should win over scroll position. Someone else's
   * arrival should not: reading back through a thread in a busy room meant
   * being thrown to the bottom every time anyone spoke.
   */
  useEffect(() => {
    const el = scrollbackRef.current
    if (!el) return
    if (pinnedToBottom.current) el.scrollTop = el.scrollHeight
  }, [lines])

  /*
   * Tapping an address, which is not quite the same as tapping a chip.
   *
   * Two things a chip never has to worry about, because a chip sits in a strip
   * you reach for on purpose while these are scattered through everything you
   * are reading.
   *
   * It never overwrites. `setInput(text)` is right for an empty prompt and
   * destroys a sentence otherwise — you read a post, start typing your answer,
   * tap the thing you are answering, and §3.9's "nothing typed is ever lost"
   * is broken by the feature that exists to save you typing. Putting the aim in
   * front instead is both safe and what you meant: `reply 8431 ` followed by
   * the answer already in the box.
   *
   * And it does nothing while a longer post is being written, where every line
   * typed is prose: the insert would go into the draft as the literal words
   * "reply 8431", quietly, in the middle of somebody's paragraph.
   */
  const aim = useCallback((text: string) => {
    if (composingRef.current !== null) return
    setInput((current) => (current === '' ? text : text + current))

    const el = inputRef.current
    if (!el) return
    el.focus()
    requestAnimationFrame(() => {
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }, [])

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
      /*
       * An empty Enter is nothing to run — except while a longer post is being
       * written, where it is a paragraph break and the single most important
       * key in the mode.
       *
       * This swallowed it silently. Found by walking the flow rather than by a
       * test: the indicator said three lines when four had been typed, and the
       * post came out as one block — which is the entire thing `write` exists
       * to make possible.
       */
      if (text === '' && composing === null) return

      // One at a time. Every command is a network round trip, and a second
      // Enter used to start a second command against the *pre-move* location:
      // outputs then landed in completion order rather than submission order,
      // and the prompt label, the URL and the last thing printed could all
      // disagree. Pressing Enter twice usually means "did that work?", which
      // the pending line below now answers.
      if (inFlight.current) return
      inFlight.current = true
      setPending(true)

      // Kept before anything can fail, so a command that errored is still
      // something you can press Up and edit rather than retype.
      if (text !== '' && history.current[history.current.length - 1] !== text) {
        history.current.push(text)
      }
      historyAt.current = null

      const echo = echoOf(text, promptLabel(name, location))
      setInput('')
      setLines((prev) => append(prev, [echo]))

      let result
      try {
        result = await run(text, location)
      } catch (error) {
        // A command that throws used to render nothing at all, which reads as
        // a dead prompt. Whatever went wrong, say it and stay usable — and
        // hand back what they typed, since it plainly did not happen.
        const failure = describeError(error)
        setLines((prev) => append(prev, failure))
        setAnnouncement(failure.map((line) => line.text).join('. '))
        setInput(text)
        return
      } finally {
        inFlight.current = false
        setPending(false)
      }

      setLines((prev) => append(prev, result.lines))
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

      /*
       * The listing above stops saying the post has one reply.
       *
       * `reply 7 <something>` exists so you never have to leave the room
       * listing, and then the listing sat there saying "1 reply — go 7" about
       * the post you had just answered. Reported that way: "it works but it
       * doesn't auto update the original post".
       *
       * Only that one line, and only the number on it. Nothing anybody wrote is
       * ever rewritten in the scrollback — this is a count the site derived
       * about itself, and every printed copy of it is corrected, because a room
       * looked at twice has two of them and fixing one would be worse than
       * fixing neither.
       */
      if (result.answered) {
        const { room, postId } = result.answered
        setLines((prev) =>
          prev.map((line) =>
            line.counts?.room === room && line.counts.postId === postId
              ? { ...withOneMoreReply(line), key: line.key }
              : line,
          ),
        )
      }

      // Words that did not send go back where they can be sent again.
      if (result.retry) setInput(result.retry)

      // §4.1 — reading your mail is what clears it.
      if (result.mail !== undefined) setMail(result.mail)
      composingRef.current = result.composing ?? null
      setComposing(result.composing ?? null)
    },
    //  is read to decide whether an empty Enter means anything, so
    // a stale closure here would swallow paragraph breaks again.
    [composing, location, name, run],
  )

  // Back and forward are navigation too, so they move you the same way `go`
  // and `leave` do, and print where you landed.
  useEffect(() => {
    const onPop = async () => {
      const target = pathToLocation(window.location.pathname)
      setLocation(target)
      try {
        const result = await run('look', target, { typed: false })
        setLines((prev) => append(prev, [{ text: '', tone: 'faint' }, ...result.lines]))
      } catch (error) {
        setLines((prev) => append(prev, describeError(error)))
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
      setLines((prev) => append(prev, [{ text: '' }, ...incoming]))
    })
  }, [subscribe, location.room, location.postId, location.person, name])

  /*
   * The reflexes anyone who has used a terminal arrives with.
   *
   * There was no onKeyDown in this codebase at all, so none of these did
   * anything. Up is the one that matters most: it is the first thing a
   * terminal-literate visitor tries — the exact people §3.5 is written to make
   * feel clever — and on a phone it is the difference between fixing a typo
   * and thumbing the whole line again. §4.5 asks whether this still feels like
   * a real interface; history and completion are the cheapest way to buy that,
   * and they pull toward the interesting end rather than away from it.
   */
  const onKey = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowUp') {
        if (history.current.length === 0) return
        event.preventDefault()
        const at = historyAt.current === null ? history.current.length : historyAt.current
        const next = Math.max(0, at - 1)
        historyAt.current = next
        setInput(history.current[next])
        return
      }

      if (event.key === 'ArrowDown') {
        if (historyAt.current === null) return
        event.preventDefault()
        const next = historyAt.current + 1
        if (next >= history.current.length) {
          historyAt.current = null
          setInput('')
        } else {
          historyAt.current = next
          setInput(history.current[next])
        }
        return
      }

      if (event.key === 'Tab') {
        // Tab used to move focus out of the prompt entirely, which loses your
        // place — worse than doing nothing.
        event.preventDefault()
        const completed = complete(input, chipsFor(location, name))
        if (completed !== null) setInput(completed)
        return
      }

      if (event.key === 'c' && event.ctrlKey) {
        event.preventDefault()
        setInput('')
        historyAt.current = null
      }
    },
    [chipsFor, input, location, name],
  )

  const label = promptLabel(name, location)

  return (
    <div
      className="app"
      /* In a terminal, clicking the output area keeps you typing. Here tapping
         the scrollback on a phone dismissed the keyboard with no way back
         except finding the thin prompt line again. Ignored when text is
         selected, so copying still works. */
      onMouseUp={() => {
        if (!window.getSelection()?.toString()) inputRef.current?.focus()
      }}
    >
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
        onScroll={(event) => {
          const el = event.currentTarget
          pinnedToBottom.current = el.scrollHeight - el.clientHeight - el.scrollTop < 40
        }}
      >
        <Scrollback lines={lines} onInsert={aim} />
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
        {mail > 0 && !pending && !composing && (
          <p className="mail" data-testid="mail">
            you have {mail} {mail === 1 ? 'reply' : 'replies'} waiting — type mail
          </p>
        )}
        {/* The one state where forgetting you are in it is expensive: every
            line goes into a draft rather than being run, and unlike the signup
            questions there is nothing being asked to remind you. So it says so
            where you are already looking, and says how to get out. */}
        {composing && !pending && (
          <p className="composing" data-testid="composing">
            writing — {composing.lines} {composing.lines === 1 ? 'line' : 'lines'},{' '}
            {composing.chars}/{Session.LIMIT} · a dot ends it
          </p>
        )}
        <Palette chips={chipsFor(location, name)} onInsert={insert} />
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
          {/* Where the caret would be, when there is not a real one — so the
              block sits exactly where your first character lands. Hidden the
              moment the field is focused, because the browser's own caret
              takes over and two would be one too many, and hidden as soon as
              there is text, because then the words are the signal. */}
          {!focused && input === '' && <span className="caret" aria-hidden="true" />}
          <input
            id="prompt"
            ref={inputRef}
            className="prompt-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKey}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
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
            /* The database caps a body at 4000. Without this the words are
               typed, sent, refused, and gone — which is the failure §3.9
               exists to prevent, so the allowance is the cap plus the longest
               prefix a body can follow.
               That prefix used to be `reply 999 `, and 4020 was plenty. It is
               now `reply <room>/<n> ` — a slug is up to 24 characters and a
               post number up to six — which is 38, so a maximum-length reply
               aimed at a long address was being silently cut at 4020. */
            maxLength={4048}
          />
        </form>
      </div>
    </div>
  )
}
