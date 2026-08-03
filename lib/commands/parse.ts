import { findCommand, type Command } from '@/lib/commands/registry'

export interface Parsed {
  /** The word the user actually typed, for echoing back in errors. */
  head: string
  arg: string
  command?: Command
}

/**
 * `cd ..` is the one alias that isn't a single word (§3.5). It is normalised
 * here rather than given a special case in the registry, so the table stays a
 * table.
 */
const CD_UP = /^cd\s+\.\.$/i

export function parse(raw: string): Parsed | null {
  const input = raw.trim()
  if (input === '') return null

  if (CD_UP.test(input)) {
    return { head: 'cd ..', arg: '', command: findCommand('leave') }
  }

  const match = input.match(/^(\S+)\s*(.*)$/s)
  if (!match) return null

  const [, head, rest] = match
  return { head, arg: rest.trim(), command: findCommand(head) }
}
