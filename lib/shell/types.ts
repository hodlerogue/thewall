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
  /**
   * Something to print in front of `text`, one step quieter than it.
   *
   * Exists for one line in the whole interface: the echo of a contribution.
   *
   * Every command echo is dimmed so the answer stands out, and that is right
   * for the twenty-three verbs whose argument is an instruction — when you type
   * `go music`, the answer is the point and the instruction should get out of
   * the way. `say` is the one where the argument is not an instruction but the
   * product. Dimming it uniformly rendered your own sentence at 9.1:1 while the
   * same words, read back in the room a moment later, were 14.0:1. The site was
   * using its brightness hierarchy to say your contribution mattered less than
   * the reading of it.
   *
   * A prefix rather than two lines, because `ryan:poker$` and what you typed
   * are one line in a terminal and splitting them would be a chat client. And a
   * prefix rather than a second tone field, because the *only* thing that ever
   * needs to recede is what the shell put there — the prompt and the verb — and
   * `text` stays whatever the line's own tone says.
   */
  prefix?: string
  /**
   * The address at the head of this line, and what tapping it types for you.
   *
   * Every line on this site that says "somebody said this" starts with the
   * thing's address — `8431`, `2`, `music/12` — and answering it means typing
   * that address back. In a room with eight thousand posts in it that is real
   * thumb work for something already on the screen, and getting a digit wrong
   * is an error rather than a wrong reply, but it is still a retype.
   *
   * So the address becomes a button, and tapping it *inserts* `reply 8431 `
   * with the cursor waiting — it never runs. That is the palette's contract
   * (§3.6), and it is what keeps this an interface somebody graduates to
   * typing rather than a set of buttons in a terminal costume (§9).
   *
   * `token` has to be a prefix of `text`, because the button is drawn by
   * splitting the line at it — `render.test.ts` asserts that for every line any
   * renderer produces. The rest of the line is untouched, which is why the
   * assertions about header shapes elsewhere still read `text` whole.
   */
  tap?: { token: string; insert: string }
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
  /**
   * How much of a longer post has been written, or null when none is.
   *
   * Set on *every* result rather than only when it changes, which is the whole
   * reason it can be trusted: compose mode is the one state where forgetting
   * you are in it is expensive — every line typed disappears into a draft, and
   * unlike the signup questions there is nothing being asked to remind you. A
   * field that only appeared on some results would leave the indicator showing
   * a stale count, which is worse than none.
   */
  composing?: { lines: number; chars: number } | null
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
