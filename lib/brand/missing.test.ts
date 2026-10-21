import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '@/lib/shell/env'

/*
 * A 404 has to mean "asked, and there is no such thing" — never "could not
 * ask". If a database blip read as missing, every room would briefly tell a
 * search engine it did not exist.
 */

const env = vi.hoisted(() => ({ current: null as Partial<Env> | null }))
vi.mock('@/lib/shell/env', () => ({ fixtureEnv: () => env.current }))

const { personIsMissing, postIsMissing, readRoom, roomIsMissing } = await import('@/lib/brand/ogData')

afterEach(() => {
  env.current = null
  vi.unstubAllEnvs()
})

describe('missing, as opposed to unreadable', () => {
  it('is missing when the database answers with nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_FIXTURES', '1')
    env.current = {
      getRoom: async () => undefined,
      getPost: async () => undefined,
      getProfile: async () => undefined,
    }
    expect(await roomIsMissing('nope')).toBe(true)
    expect(await postIsMissing('music', 9999)).toBe(true)
    expect(await personIsMissing('nobody')).toBe(true)
  })

  it('is not missing when the read fails', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_FIXTURES', '1')
    const down = async () => {
      throw new Error('connection reset')
    }
    env.current = { getRoom: down, getPost: down, getProfile: down }
    expect(await roomIsMissing('music')).toBe(false)
    expect(await postIsMissing('music', 12)).toBe(false)
    expect(await personIsMissing('marisol')).toBe(false)
    // And the page itself still gets "nothing came back", as it always did.
    expect(await readRoom('music')).toBeUndefined()
  })

  it('is not missing when there is no database configured at all', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_FIXTURES', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    expect(await roomIsMissing('music')).toBe(false)
  })

  it('is not missing when the thing is there', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_FIXTURES', '1')
    env.current = { getRoom: async () => ({ slug: 'music' }) as never }
    expect(await roomIsMissing('music')).toBe(false)
  })
})
