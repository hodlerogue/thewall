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
  /**
   * Someone — `~marisol`. Their page, and their wall.
   *
   * This began as a view with nothing postable on it, on §3.10's warning that a
   * space which absorbs activity "deletes the geography that makes this feel
   * like a place". Walls were built anyway, deliberately: a wall is a *room
   * with an owner*, so it inherits addresses, replies, mail, search and every
   * moderation lever without the shell learning a second kind of place — and
   * the one thing it does not inherit is a line in the lobby, which is where
   * §3.10's warning actually bites.
   *
   * Every post shown here still carries its real room/id, so a profile remains
   * a set of doors: some of them lead back into rooms, and some lead to `~name`.
   */
  person?: string
}

export type Context = 'lobby' | 'room' | 'commons' | 'post' | 'person'

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
  /** §4.1 — a fresh unread count, when the command changed it. */
  mail?: number
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
  if (location.person !== undefined) return 'person'
  if (location.postId !== undefined) return 'post'
  if (location.room === undefined) return 'lobby'
  return ephemeralRooms.includes(location.room) ? 'commons' : 'room'
}

/** `jameson:music/12$` — where you are, displayed where you are already looking. */
export function promptLabel(name: string | null, location: Location): string {
  const path =
    location.person !== undefined
      ? `~${location.person}`
      : location.room === undefined
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
  if (location.person !== undefined) return `/~${location.person}`
  if (location.room === undefined) return '/lobby'
  if (location.postId === undefined) return `/${location.room}`
  return `/${location.room}/${location.postId}`
}

export function pathToLocation(pathname: string): Location {
  const [room, postId] = pathname.split('/').filter(Boolean)
  if (room?.startsWith('~')) {
    const person = room.slice(1)
    // A bare `/~` names nobody. Passing an empty string on would ask the
    // database for a profile called "" and report that they don't exist.
    if (!person) return {}
    /*
     * `/~marisol` is somebody; `/~marisol/3` is something on their wall.
     *
     * A wall is a room (see the walls migration), so the second one is an
     * ordinary post location whose room happens to be spelled with a tilde —
     * which is what lets `go`, `say`, `reply`, mail and moderation all reach it
     * without learning a new kind of address.
     */
    if (postId !== undefined && /^\d+$/.test(postId)) return { room, postId: Number(postId) }
    return { person }
  }
  if (room === undefined || room === 'lobby') return {}
  return postId !== undefined && /^\d+$/.test(postId)
    ? { room, postId: Number(postId) }
    : { room }
}
