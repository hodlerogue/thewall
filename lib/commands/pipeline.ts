/**
 * §4.8 — "the thing separating 'real interface' from 'terminal costume' is
 * commands that chain."
 *
 * One source, a few flags, a pipe, a sink. Deliberately small: the doc asks for
 * exactly one working pipe, documented only inside `what posts` and never
 * advertised, so the curious find it and nobody else has to care.
 *
 * Pipes are only split for commands that opt in. Otherwise `say i love a|b`
 * would become a pipeline and eat half of someone's sentence.
 */

export interface Stage {
  head: string
  rest: string
}

export function splitStages(input: string): Stage[] {
  return input
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const match = part.match(/^(\S+)\s*(.*)$/s)
      return { head: match?.[1] ?? part, rest: match?.[2]?.trim() ?? '' }
    })
}

export interface Flags {
  values: Map<string, string>
  /** Anything that wasn't a --flag, kept so errors can quote it back. */
  loose: string[]
}

export function parseFlags(input: string): Flags {
  const values = new Map<string, string>()
  const loose: string[] = []

  for (const token of input.split(/\s+/).filter(Boolean)) {
    const match = token.match(/^--([a-z][a-z-]*)(?:=(.*))?$/i)
    if (match) {
      values.set(match[1].toLowerCase(), match[2] ?? '')
    } else {
      loose.push(token)
    }
  }

  return { values, loose }
}

/**
 * `7d`, `24h`, `30m`. Returns the instant that far back, or null if it isn't a
 * duration — the caller turns that into a sentence rather than an error code.
 */
export function parseSince(value: string, now: Date = new Date()): Date | null {
  const match = value.trim().match(/^(\d+)\s*([mhdw])$/i)
  if (!match) return null

  const amount = Number(match[1])
  if (amount === 0) return null

  const minutes = { m: 1, h: 60, d: 60 * 24, w: 60 * 24 * 7 }[match[2].toLowerCase()]!
  return new Date(now.getTime() - amount * minutes * 60_000)
}
