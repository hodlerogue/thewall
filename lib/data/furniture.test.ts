import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The permanent rooms are named, in both places that decide it.
 *
 * Reported as `builders` missing from the lobby on a project that had applied
 * every migration — including the one written to stop exactly that.
 *
 * A room that is not furniture drops out of the lobby after a fortnight with
 * nothing said in it, which is the design. Furniture is `curated`, and both the
 * seed and 20260806000000 set it with
 *
 *     where owner_id is null and created_by is null
 *
 * using "nobody is recorded as having made this" to mean "the seed inserted
 * it". True of the row the seed inserts, false of the same *name* existing
 * because somebody typed `make builders` — which is likeliest for `builders`
 * exactly, because it was added to the seed after launch, so any project seeded
 * before that never received it. Such a row sits outside every repair and
 * quietly leaves the front page.
 *
 * Why this is a source-reading test and not a database one: `npm run test:db`
 * builds a fresh database, migrations then seed, and the seed's blanket repair
 * runs last. Every seeded room comes out curated there no matter what the
 * migrations did, so the broken state cannot be constructed and the assertions
 * pass whether or not the repair exists. That was tried first, and three
 * assertions passed with the repair deleted.
 *
 * What can be checked without a database is the thing that was actually wrong:
 * whether the permanent set is written down, and whether the two places that
 * write it down agree.
 */

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/** SQL comments carry the argument, and the argument names slugs too (§). */
const stripComments = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')

const REPAIR = 'supabase/migrations/20260907000000_furniture_is_named.sql'

/**
 * The permanent set, read from the two files that create it.
 *
 * Nine come from the seed's one values block. `feed` is the tenth and arrives
 * in its own migration, because it is a room the site derives rather than one
 * people walk into — so it is read from there rather than hard-coded, or this
 * test would pass while disagreeing with the schema.
 */
function seededRooms(): string[] {
  const inserted = (sql: string): string[] => {
    const block = /insert into public\.rooms \(slug[^;]*?values([^;]*);/i.exec(sql)
    expect(block, 'rooms are still inserted in one values block').not.toBeNull()
    return [...block![1].matchAll(/\(\s*'([a-z0-9-]+)'/g)].map((m) => m[1])
  }

  return [
    ...inserted(stripComments(read('supabase/seed.sql'))),
    ...inserted(stripComments(read('supabase/migrations/20260805040000_feed.sql'))),
  ].sort()
}

/** The rooms the repair names. */
function namedByRepair(): string[] {
  const sql = stripComments(read(REPAIR))
  const list = /set\s+curated\s*=\s*true\s+where\s+slug\s+in\s*\(([^)]*)\)/i.exec(sql)
  expect(list, 'the repair still marks furniture by naming slugs').not.toBeNull()
  return [...list![1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]).sort()
}

describe('the permanent rooms', () => {
  it('are the ten the seed puts there', () => {
    // Named so a reader can see the set without running anything, and so that
    // adding an eleventh is a decision rather than an accident.
    expect(seededRooms()).toEqual([
      'builders',
      'commons',
      'crypto',
      'feed',
      'feedback',
      'kitchen',
      'latenight',
      'movies',
      'music',
      'poker',
    ])
  })

  it('are every one of them in the repair, so none can quietly fade', () => {
    // The failure this catches: somebody adds a room to the seed and does not
    // add it here. On a fresh database nothing goes wrong — the seed's own
    // blanket repair covers it — and on every project that was seeded earlier
    // and made the room by hand, it fades after a fortnight.
    expect(namedByRepair()).toEqual(seededRooms())
  })

  it('are repaired by name, never by who is recorded as having made them', () => {
    /*
     * The whole bug in one line. `created_by is null` is a guess at "seeded",
     * and it is wrong in both directions: it misses a seeded name somebody
     * remade, and — as `schema.test.sql` pins separately — it would promote
     * anybody's room the moment its creator erased their account, since that
     * column is `on delete set null`.
     */
    const sql = stripComments(read(REPAIR))
    expect(sql).not.toMatch(/created_by\s+is\s+null/i)
  })

  it('leave commons the one that keeps nothing', () => {
    // A blanket `ephemeral = false` over the set would make commons permanent,
    // which is §3.10 inverted — everything said there is meant to be gone in a
    // day. The repair states commons separately, so this pins that it does.
    const sql = stripComments(read(REPAIR))
    expect(sql).toMatch(/set\s+ephemeral\s*=\s*true\s+where\s+slug\s*=\s*'commons'/i)
    expect(sql).not.toMatch(/set\s+ephemeral\s*=\s*false[^;]*'commons'/i)
  })
})
