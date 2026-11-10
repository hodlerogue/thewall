import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { supabaseEnv } from '@/lib/data/supabaseEnv'
import { describeError } from '@/lib/shell/errors'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'

/*
 * The site deploys the moment main moves. The migrations are applied by hand,
 * possibly days later. So the code has to run against the database as it was
 * before 20261022000000 and 20261023000000.
 *
 * This stands in for that database at the one boundary that matters: what it
 * accepts. PostgREST resolves a function by the exact set of argument names and
 * refuses unknown columns, so a new argument or column asked of the old schema
 * fails the same way here as it would in somebody's browser.
 */

/** What the old schema will answer to. */
const OLD_ARGS: Record<string, readonly string[]> = {
  search_said: ['p_text', 'p_room', 'p_by', 'p_since', 'p_limit'],
  find_rooms: ['p_term', 'p_limit'],
  wall_feed: ['p_limit'],
  rooms_from: ['p_slug'],
  name_changed_hands: ['p_name'],
}
const OLD_OVERVIEW = ['slug', 'gloss', 'ephemeral', 'sort_order', 'curated', 'latest_body', 'latest_at', 'latest_author']

const NOW = new Date().toISOString()
const SAID = { room: 'music', post_no: 4, author: 'marisol', body: 'on the old schema', created_at: NOW, is_reply: false }

function oldDatabase() {
  const rejected: string[] = []

  const rows: Record<string, unknown[]> = {
    room_overview: [
      { slug: 'music', gloss: 'songs', ephemeral: false, curated: true, latest_body: 'hi', latest_at: NOW, latest_author: 'tuck' },
      { slug: 'feed', gloss: 'walls', ephemeral: false, curated: true, latest_body: null, latest_at: null, latest_author: null },
    ],
    profiles: [{ name: 'marisol', created_at: NOW, verified_at: NOW }],
    rooms: [{ slug: 'music', gloss: 'songs', ephemeral: false, owner: null }],
    posts: [],
  }
  const answers: Record<string, unknown> = {
    search_said: [SAID],
    // No `listed_in`: it is the column the new migration adds.
    find_rooms: [{ slug: 'music', gloss: 'songs', curated: true, in_lobby: true, latest_at: NOW, post_count: 3 }],
    wall_feed: [{ room: '~marisol', post_no: 1, author: 'marisol', body: 'on my wall', created_at: NOW, replies: 0 }],
    rooms_from: [],
    name_changed_hands: null,
  }

  const query = (table: string) => {
    let filtered = rows[table] ?? []
    let refusal: { message: string } | null = null
    const result = () => ({ data: filtered, error: refusal, count: filtered.length })
    const builder = {
      select(columns: string) {
        if (table === 'room_overview') {
          for (const column of columns.split(',').map((c) => c.trim())) {
            if (!OLD_OVERVIEW.includes(column)) {
              refusal = { message: `column room_overview.${column} does not exist` }
              rejected.push(column)
            }
          }
        }
        return builder
      },
      eq: (column: string, value: unknown) => {
        filtered = filtered.filter((row) => (row as Record<string, unknown>)[column] === value)
        return builder
      },
      order: () => builder,
      limit: () => builder,
      lt: () => builder,
      maybeSingle: async () => ({ data: filtered[0] ?? null, error: refusal }),
      then: <T>(done: (value: ReturnType<typeof result>) => T) => Promise.resolve(result()).then(done),
    }
    return builder
  }

  const client = {
    from: query,
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      const known = OLD_ARGS[fn]
      const unknown = Object.keys(args).filter((arg) => !known?.includes(arg))
      if (!known || unknown.length > 0) {
        rejected.push(`${fn}(${unknown.join(', ')})`)
        return {
          data: null,
          error: {
            code: 'PGRST202',
            message: `Could not find the function public.${fn}(${Object.keys(args).join(', ')}) in the schema cache`,
          },
        }
      }
      return { data: answers[fn], error: null }
    },
  } as unknown as SupabaseClient

  return { client, rejected }
}

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')

function site() {
  const { client, rejected } = oldDatabase()
  const session = new Session({} as SignupApi, {} as Writer, null)
  return { run: createRunner(supabaseEnv(client), ['commons'], session), rejected }
}

describe('everything that works today, on the database as it was', () => {
  it('draws the lobby', async () => {
    const { run, rejected } = site()
    expect(text((await run('look', {})).lines)).toContain('music')
    expect(rejected).toEqual([])
  })

  it('finds what was said', async () => {
    const { run, rejected } = site()
    expect(text((await run('find schema', {})).lines)).toContain('on the old schema')
    expect(rejected).toEqual([])
  })

  it('finds rooms, without the column that is not there yet', async () => {
    const { run, rejected } = site()
    const out = text((await run('find --rooms music', {})).lines)
    expect(out).toContain('music')
    expect(out).not.toContain('undefined')
    expect(rejected).toEqual([])
  })

  it('opens somebody’s page', async () => {
    const { run, rejected } = site()
    const page = await run('go ~marisol', {})
    expect(page.location).toEqual({ person: 'marisol' })
    expect(text(page.lines)).toContain('on the old schema')
    expect(rejected).toEqual([])
  })

  it('opens the feed', async () => {
    const { run, rejected } = site()
    expect(text((await run('go feed', {})).lines)).toContain('on my wall')
    expect(rejected).toEqual([])
  })
})

describe('what needs the new database waits, and says so', () => {
  const FULL: Location = { person: 'marisol' }

  it('older on a page says it is not switched on, and the prompt carries on', async () => {
    const { client } = oldDatabase()
    const env = supabaseEnv(client)
    // A page that filled, so `older` really does have to ask for more.
    const many = Array.from({ length: 10 }, (_, i) => ({
      room: 'music', id: i + 1, author: 'marisol', body: 'x', createdAt: new Date(), isReply: false,
    }))
    env.getProfile = async () => ({ name: 'marisol', joinedAt: new Date(), verified: true, posts: many })
    const run = createRunner(env, ['commons'], new Session({} as SignupApi, {} as Writer, null))

    // Terminal prints whatever a command throws through describeError.
    const failure = await Promise.resolve(run('older', FULL)).then(
      () => undefined,
      (thrown: unknown) => thrown,
    )
    expect(text(describeError(failure))).toContain('isn’t switched on yet')
    expect(text((await run('find schema', FULL)).lines)).toContain('on the old schema')
  })

  it('an ordinary search never names the argument the old database lacks', async () => {
    const { client, rejected } = oldDatabase()
    await supabaseEnv(client).searchPosts({ by: 'marisol', limit: 10 })
    expect(rejected).toEqual([])
  })
})
