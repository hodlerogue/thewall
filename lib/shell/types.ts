/**
 * Shared vocabulary for the shell. Phase 1 uses these against fixtures; the
 * command registry and the Supabase-backed handlers fill the same shapes.
 */

export type Tone = 'default' | 'echo' | 'dim' | 'faint' | 'error' | 'accent'

/** One rendered line of scrollback. `depth` is §3.2 indentation, not a tree. */
export interface Line {
  text: string
  tone?: Tone
  depth?: 0 | 1 | 2
}

/**
 * The only navigation state there is. It drives the prompt string, the palette
 * set, the valid command set, and the URL — all from this one value (§3.1).
 */
export interface Location {
  room?: string
  postId?: number
}

export type Context = 'lobby' | 'room' | 'commons' | 'post'

/** A palette entry reads `verb — what it does` (§3.6): a glossary, not a toolbar. */
export interface Chip {
  verb: string
  gloss: string
  /** Text placed in the prompt. Trailing space when an argument is expected. */
  insert: string
}

export interface RunResult {
  lines: Line[]
  /** Present when the command moved you. Absent means you stayed put. */
  location?: Location
}

export type Runner = (
  input: string,
  location: Location,
) => RunResult | Promise<RunResult>

export function contextOf(location: Location, ephemeralRooms: readonly string[]): Context {
  if (location.postId !== undefined) return 'post'
  if (location.room === undefined) return 'lobby'
  return ephemeralRooms.includes(location.room) ? 'commons' : 'room'
}

/** `jameson:music/12$` — where you are, displayed where you are already looking. */
export function promptLabel(name: string | null, location: Location): string {
  const path =
    location.room === undefined
      ? 'lobby'
      : location.postId === undefined
        ? location.room
        : `${location.room}/${location.postId}`
  return `${name ?? 'guest'}:${path}$`
}

/** The path half of the prompt is also the URL (§3.4) — one value, two surfaces. */
export function locationToPath(location: Location): string {
  if (location.room === undefined) return '/'
  if (location.postId === undefined) return `/${location.room}`
  return `/${location.room}/${location.postId}`
}
