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
  /** Present when signup finished, so the prompt can stop saying `guest`. */
  identity?: string | null
  /**
   * Text to put back in the prompt because sending it failed.
   *
   * §3.9's proudest mechanic is that you never re-type your sentence. That was
   * honoured for the signup interruption and broken for every network blip:
   * the input cleared before the write was attempted, so a failure left the
   * words only in the echo line, behind a long-press.
   */
  retry?: string
}

export interface RunOptions {
  /**
   * False when the shell issued this itself rather than the user typing it.
   *
   * It matters because mid-signup the prompt treats input as an *answer*, and
   * a synthetic command routed down that path becomes your name. Browser Back
   * during signup used to run `look`, which is a perfectly valid name, so the
   * next thing typed — the email — created an account called `look`, forever.
   */
  typed?: boolean
}

export type Runner = (
  input: string,
  location: Location,
  options?: RunOptions,
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

/**
 * The path half of the prompt is also the URL (§3.4) — one value, two
 * surfaces, which is why `thewall.social/music/12` costs nothing to support.
 *
 * The lobby has its own address rather than living at `/`, because `/` is the
 * front door and §3.10 puts arrivals in commons. If they shared a path, the
 * redirect that starts you in commons would also make `leave` impossible.
 */
export function locationToPath(location: Location): string {
  if (location.room === undefined) return '/lobby'
  if (location.postId === undefined) return `/${location.room}`
  return `/${location.room}/${location.postId}`
}

export function pathToLocation(pathname: string): Location {
  const [room, postId] = pathname.split('/').filter(Boolean)
  if (room === undefined || room === 'lobby') return {}
  return postId !== undefined && /^\d+$/.test(postId)
    ? { room, postId: Number(postId) }
    : { room }
}
