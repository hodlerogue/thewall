'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Palette } from '@/components/Palette'
import type { Chip, Line, Location, Runner } from '@/lib/shell/types'
import { promptLabel } from '@/lib/shell/types'

export function Terminal({
  initialLines,
  initialLocation,
  run,
  chipsFor,
  name: initialName = null,
}: {
  initialLines: readonly Line[]
  initialLocation: Location
  run: Runner
  chipsFor: (location: Location) => readonly Chip[]
  name?: string | null
}) {
  const [lines, setLines] = useState<Line[]>([...initialLines])
  const [location, setLocation] = useState<Location>(initialLocation)
  const [name, setName] = useState<string | null>(initialName)
  const [input, setInput] = useState('')

  const scrollbackRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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

      const echo: Line = { text: `${promptLabel(name, location)} ${text}`, tone: 'echo' }
      setInput('')
      setLines((prev) => [...prev, echo])

      const result = await run(text, location)
      setLines((prev) => [...prev, ...result.lines])
      if (result.location) setLocation(result.location)
      // §3.9 — the prompt stops saying `guest` the moment there is a name.
      if (result.identity !== undefined) setName(result.identity)
    },
    [location, name, run],
  )

  const label = promptLabel(name, location)

  return (
    <div className="app">
      <div className="scrollback" ref={scrollbackRef} data-testid="scrollback">
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
            aria-label="command"
          />
        </form>
      </div>
    </div>
  )
}
