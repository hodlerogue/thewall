/**
 * Name rules for the first signup question (§3.9).
 *
 * The prompt asks "what do you want to be called?" and has to answer badly
 * typed input the way a person would — say what's wrong in one line and offer
 * something that works — rather than rejecting and asking again.
 *
 * The shape here matches the `profiles_name_shape` check in the schema, so the
 * database can never disagree with the prompt about what a name is.
 */

export const NAME_PATTERN = /^[a-z0-9_]{2,20}$/

export type NameProblem =
  | { ok: true; name: string }
  | { ok: false; reason: string; suggestion?: string }

export function validateName(raw: string): NameProblem {
  const name = raw.trim().toLowerCase()

  if (name === '') return { ok: false, reason: 'you have to be called something.' }

  if (name.length < 2) {
    return { ok: false, reason: 'that’s a bit short — two characters at least.' }
  }

  if (name.length > 20) {
    return {
      ok: false,
      reason: 'that’s longer than twenty characters.',
      suggestion: sanitize(name).slice(0, 20),
    }
  }

  if (!NAME_PATTERN.test(name)) {
    const cleaned = sanitize(name)
    return {
      ok: false,
      reason: 'letters, numbers and underscores only.',
      suggestion: NAME_PATTERN.test(cleaned) ? cleaned : undefined,
    }
  }

  if (RESERVED.has(name)) {
    return { ok: false, reason: `${name} is spoken for.`, suggestion: `${name}_` }
  }

  return { ok: true, name }
}

function sanitize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

/**
 * §3.9 — on collision, suggest alternates rather than just saying no. Ordered
 * from the least disfiguring to the most, so the first offer is the one closest
 * to what they actually asked for.
 */
export function suggestAlternates(name: string, taken: ReadonlySet<string>): string[] {
  const candidates = [
    `${name}_`,
    ...[1, 2, 3, 4, 7, 9].map((n) => `${name}${n}`),
    `the${name}`,
    `${name}_${new Date().getUTCFullYear() % 100}`,
  ]

  const out: string[] = []
  for (const candidate of candidates) {
    if (out.length === 3) break
    if (candidate.length > 20) continue
    if (taken.has(candidate)) continue
    if (!NAME_PATTERN.test(candidate)) continue
    out.push(candidate)
  }
  return out
}

/** Names that would let someone impersonate the system or its messages. */
const RESERVED = new Set([
  'guest',
  'admin',
  'root',
  'system',
  'thewall',
  'commons',
  'lobby',
  'moderator',
  'mod',
  'support',
  'help',
  'staff',
])
