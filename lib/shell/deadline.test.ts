import { PostgrestClient } from '@supabase/postgrest-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithin, GaveUp, NO_ANSWER, PROMPT_MS, within } from '@/lib/shell/deadline'
import { describeError } from '@/lib/shell/errors'

/**
 * A slow command must never own the prompt.
 *
 * Reported from an iPhone: one `look` in commons printed `…` and held every
 * later Enter for twenty-odd seconds. These pin the two limits that stop it —
 * the prompt's, and each request's — and the one detail that makes the second
 * work at all: postgrest-js retries a failed read unless the failure is an
 * abort.
 */

/** A server that accepts the request and never says anything. */
function silent(): typeof fetch {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      }),
  ) as unknown as typeof fetch
}

afterEach(() => {
  vi.useRealTimers()
})

describe('within', () => {
  it('hands the prompt back when a command never answers', async () => {
    vi.useFakeTimers()
    const never = new Promise<never>(() => {})
    const waited = within(never)
    const settled = expect(waited).rejects.toBeInstanceOf(GaveUp)
    await vi.advanceTimersByTimeAsync(PROMPT_MS)
    await settled
  })

  it('passes an answer through untouched', async () => {
    await expect(within(Promise.resolve('here'))).resolves.toBe('here')
  })

  it('passes a failure through untouched', async () => {
    const failure = new Error('no such room')
    await expect(within(Promise.reject(failure))).rejects.toBe(failure)
  })

  it('says what happened rather than going quiet', () => {
    const lines = describeError(new GaveUp(PROMPT_MS))
    expect(lines[0].text).toBe('no answer after 15 seconds, so that was given up on.')
    expect(lines[1].text).toMatch(/look first/)
  })
})

describe('fetchWithin', () => {
  it('gives up on a silent server', async () => {
    const timed = fetchWithin(20, silent())
    await expect(timed('https://example.test')).rejects.toMatchObject({
      name: 'AbortError',
      message: NO_ANSWER,
    })
  })

  it('still lets a caller cancel first', async () => {
    const controller = new AbortController()
    const timed = fetchWithin(10_000, silent())
    const asked = timed('https://example.test', { signal: controller.signal })
    controller.abort(new Error('changed my mind'))
    await expect(asked).rejects.toThrow('changed my mind')
  })

  /*
   * The real query client — the one supabase-js reads tables through — so an
   * upgrade that changes how it retries is caught here rather than on
   * somebody's phone. (Not the whole of supabase-js: it opens a realtime socket
   * on construction, which Node 20 has no WebSocket for.) With any name but AbortError
   * this read is sent four times with 1s, 2s and 4s between — the timeout
   * would only have made the wait longer.
   */
  it('is not retried by the Supabase client, and reads as plain words', async () => {
    const server = silent()
    const client = new PostgrestClient('https://example.test/rest/v1', { fetch: fetchWithin(20, server) })

    const { error } = await client.from('rooms').select('slug').eq('slug', 'commons').maybeSingle()

    expect(server).toHaveBeenCalledTimes(1)
    expect(error).not.toBeNull()
    expect(describeError(error)[0]).toEqual({ text: NO_ANSWER, tone: 'error' })
  })
})
