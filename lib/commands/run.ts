import { parse } from '@/lib/commands/parse'
import {
  CHIP_SETS,
  COMMANDS,
  findCommand,
  nearestCommand,
  OWN_WALL_CHIPS,
} from '@/lib/commands/registry'
import type { Env } from '@/lib/shell/env'
import type { Session } from '@/lib/shell/session'
import type { Chip, Context, Location, RunOptions, RunResult, Runner } from '@/lib/shell/types'
import { contextOf } from '@/lib/shell/types'

/**
 * Turns typed text into lines, going through the registry for everything.
 *
 * §3.7 — errors teach: unknown input guesses the nearest verb *and shows its
 * description*, wrong-context commands name the fix. There are no error codes
 * and nothing ever says "invalid syntax".
 */
export function createRunner(
  env: Env,
  ephemeralRooms: readonly string[],
  session: Session,
): Runner {
  return async (
    input: string,
    location: Location,
    options?: RunOptions,
  ): Promise<RunResult> => {
    // §3.9 — mid-signup, what you type is an answer, not a command. Without
    // this, a name like "read" would be parsed as a verb and swallowed.
    //
    // Only for input a person actually typed: anything the shell issues itself
    // must stay a command, or navigating during signup answers the question
    // for you.
    if (session.isAsking() && options?.typed !== false) {
      const { lines, identity, retry, location: moved } = await session.answer(input)
      // `location` because an answer can now move you: naming what a room is
      // for opens it and walks you in, and dropping it here left the lines
      // saying "you are in it" while the prompt still named the old room.
      return { lines, identity, retry, location: moved }
    }

    const parsed = parse(input)
    if (!parsed) return { lines: [] }

    const context = contextOf(location, ephemeralRooms)

    // Resolved at most once, and only if something asks. See HandlerArgs.hint.
    let hinted: Promise<string> | undefined
    const hint = () => (hinted ??= roomHint(env))

    if (!parsed.command) {
      const near = nearestCommand(parsed.head)
      return {
        lines: [
          {
            text: near
              ? `i don’t know "${parsed.head}". did you mean ${near.verb} — ${near.gloss(context)}?`
              : `i don’t know "${parsed.head}". type help to see what you can type from here.`,
            tone: 'error',
          },
        ],
      }
    }

    if (!parsed.command.contexts.includes(context)) {
      return {
        lines: [{ text: parsed.command.wrongContext(context, await hint()), tone: 'error' }],
      }
    }

    return parsed.command.run({ arg: parsed.arg, location, context, env, hint, session })
  }
}

/** A real room to name in an error, so "try: go music" is never a dead end. */
async function roomHint(env: Env): Promise<string> {
  const rooms = await env.listRooms()
  return rooms.find((room) => !room.ephemeral)?.slug ?? rooms[0]?.slug ?? 'commons'
}

/** §3.6 — the palette, derived from the registry so it can never drift from it. */
export function createChipsFor(ephemeralRooms: readonly string[]) {
  return (location: Location, name: string | null = null): readonly Chip[] =>
    chipsForContext(
      contextOf(location, ephemeralRooms),
      // Your own page is the one profile with a `say` on it, because it is the
      // one wall you may start something on.
      location.person !== undefined && location.person === name,
    )
}

export function chipsForContext(context: Context, ownWall = false): readonly Chip[] {
  const verbs = context === 'person' && ownWall ? OWN_WALL_CHIPS : CHIP_SETS[context]
  return verbs.map((verb) => {
    const command = findCommand(verb)
    if (!command) throw new Error(`palette names an unknown command: ${verb}`)
    return { verb: command.verb, gloss: command.gloss(context), insert: command.insert(context) }
  })
}

export { COMMANDS }
