/**
 * How long anything typed is allowed to hold the prompt.
 *
 * Reported from an iPhone in commons: `look` several times, each fine, then one
 * that printed `…` and nothing else — and every Enter after it did nothing for
 * twenty-odd seconds. The prompt runs one command at a time (see `submit` in
 * components/Terminal.tsx), and nothing anywhere put a limit on how long that
 * one could take. supabase-js has no request timeout, its reads retry quietly
 * after 1s, 2s and 4s, and a signed-in session's token refresh retries for up
 * to 30s — any of those, behind a phone's flaky connection, is a frozen site.
 *
 * Two limits, one inside the other. Each request gives up at REQUEST_MS, so a
 * stalled connection becomes an error that says so. The prompt gives up at
 * PROMPT_MS whatever the reason, because a request is not the only thing a
 * command can wait on — `install` once froze the prompt on a browser dialog.
 */
export const REQUEST_MS = 10_000
export const PROMPT_MS = 15_000
/** When `…` grows words, so a slow answer looks slow rather than dead. */
export const SLOW_MS = 3_000

/** The prompt stopped waiting. The work may still finish — nobody is listening. */
export class GaveUp extends Error {
  constructor(ms: number) {
    super(`no answer after ${Math.round(ms / 1000)} seconds, so that was given up on.`)
    this.name = 'GaveUp'
  }
}

/** `work`, or GaveUp once `ms` has passed without it settling. */
export function within<T>(work: T | Promise<T>, ms: number = PROMPT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new GaveUp(ms)), ms)
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * The words a request that ran out of time fails with.
 *
 * Named `AbortError` on purpose. postgrest-js retries a failed GET three times
 * with pauses between, and the one failure it does not retry is an abort — so
 * any other name would turn one 10-second wait into four of them.
 */
export const NO_ANSWER = 'the server didn’t answer in time.'

/**
 * `fetch`, with a limit. Handed to the browser's Supabase client, which uses it
 * for every table read, every function call and the token refresh.
 *
 * A caller's own signal still works: whichever fires first wins.
 */
export function fetchWithin(ms: number = REQUEST_MS, base: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const controller = new AbortController()
    const timeout = Object.assign(new Error(NO_ANSWER), { name: 'AbortError' })
    const timer = setTimeout(() => controller.abort(timeout), ms)

    const outer = init?.signal
    if (outer) {
      if (outer.aborted) controller.abort(outer.reason)
      else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true })
    }

    return base(input, { ...init, signal: controller.signal })
      .catch((error: unknown) => {
        // Some browsers reject with their own AbortError rather than the
        // reason given; the words are what anyone reads, so they are ours.
        throw controller.signal.reason === timeout ? timeout : error
      })
      .finally(() => clearTimeout(timer))
  }
}
