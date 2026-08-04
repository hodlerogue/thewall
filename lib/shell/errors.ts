import type { Line } from '@/lib/shell/types'

/**
 * Turns whatever was thrown into something a person can act on.
 *
 * Supabase does not throw `Error` instances — a PostgrestError is a plain
 * object `{ message, details, hint, code }`. So `String(error)` on one yields
 * "[object Object]" and discards the only useful part, which is exactly what
 * this used to do. Anything that reaches a screen goes through here.
 *
 * The same rule as §3.7 applies to operational failures as to typos: say what
 * is wrong and name the fix. "[object Object]" fails both halves.
 */
export function describeError(error: unknown): Line[] {
  const detail = extract(error)
  const lines: Line[] = [{ text: detail.message, tone: 'error' }]

  const fix = suggestFix(detail)
  if (fix) lines.push({ text: fix, tone: 'faint' })
  else if (detail.hint) lines.push({ text: detail.hint, tone: 'faint' })

  return lines
}

interface Detail {
  message: string
  code?: string
  hint?: string
}

function extract(error: unknown): Detail {
  if (error instanceof Error) return { message: error.message }

  if (typeof error === 'string') return { message: error }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message =
      str(record.message) ??
      str(record.error_description) ??
      str(record.error) ??
      // Last resort, but still information rather than "[object Object]".
      safeJson(record)

    return {
      message,
      code: str(record.code),
      hint: str(record.hint) ?? str(record.details),
    }
  }

  return { message: 'something went wrong, and it didn’t say what.' }
}

/**
 * The failures worth recognising by name, because each has one obvious cause
 * and the raw message does not point at it.
 */
function suggestFix(detail: Detail): string | undefined {
  const code = detail.code ?? ''
  const message = detail.message.toLowerCase()

  // PostgREST cannot find the table, or Postgres says it does not exist.
  if (code === 'PGRST205' || code === '42P01' || message.includes('schema cache')) {
    return 'the schema hasn’t been applied to this project yet — run scripts/db-deploy.sh'
  }

  // PGRST202 is a *function* that is not there, which means a migration landed
  // and a later one did not. It reads nothing like the table case and used to
  // fall through to the raw message — which is how a missing mark_verified()
  // presented as a verification link that simply would not work.
  if (code === 'PGRST202' || message.includes('could not find the function')) {
    return 'this project is missing a database update — run scripts/db-deploy.sh, then try again.'
  }

  if (code === '42501' || message.includes('permission denied')) {
    return 'the anon role can’t read that. the grants live at the end of the initial migration.'
  }

  if (message.includes('invalid api key') || message.includes('invalid jwt')) {
    return 'check NEXT_PUBLIC_SUPABASE_ANON_KEY — and remember it is baked in at build time, so it needs a redeploy.'
  }

  if (message.includes('failed to fetch') || message.includes('networkerror')) {
    return 'couldn’t reach the project at all. check NEXT_PUBLIC_SUPABASE_URL.'
  }

  return undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function safeJson(value: unknown): string {
  try {
    const json = JSON.stringify(value)
    return json && json !== '{}' ? json : 'something went wrong, and it didn’t say what.'
  } catch {
    return 'something went wrong, and it didn’t say what.'
  }
}
