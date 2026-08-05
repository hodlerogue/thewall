import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The one class of bug no suite here can catch by running anything.
 *
 * PostgREST resolves `author:profiles(name)` by looking for a foreign key
 * between the two tables. One key, one answer. **Two keys and it refuses the
 * whole query** rather than picking — so the failure is not a wrong field, it
 * is no data at all, on every request that runs it.
 *
 * That happened: adding `rooms.created_by` beside `rooms.owner_id` gave `rooms`
 * a second foreign key to `profiles`, and the room query started coming back as
 * "Could not embed because more than one relationship was found". Nothing here
 * saw it. The e2e suite runs against fixtures, and `test:db` talks to Postgres
 * directly and never goes near PostgREST — so the only thing that exercises
 * these strings is a real deployment, which is where it was found.
 *
 * So this reads the source and checks the strings themselves, the same way
 * `app/api/signup/order.test.ts` checks an ordering no test could observe.
 */

const source = readFileSync(join(process.cwd(), 'lib/data/supabaseEnv.ts'), 'utf8')

/**
 * Every query in the file, as the table it reads and everything written until
 * the next one.
 *
 * Split rather than matched. Pairing `.from` with its `.select` by regex needs
 * a bound on what sits between them, and a comment longer than the bound makes
 * the whole query invisible to the check — which is precisely what happened.
 * Splitting has no such blind spot: a query is missed only if `.from(` is
 * missing, and then there is no query.
 */
function queries(): { table: string; body: string }[] {
  return source
    .split(".from('")
    .slice(1)
    .map((chunk) => ({
      table: chunk.slice(0, chunk.indexOf("'")),
      body: chunk,
    }))
}

/**
 * How many foreign keys each table has to `profiles`, read from the migrations
 * rather than remembered. When somebody adds another one, this number moves on
 * its own and the assertion below starts demanding a disambiguated embed.
 */
function migrationFiles(): string[] {
  // Read from the probe list rather than the directory, so this covers exactly
  // the migrations the deploy script knows about — a file nobody registered is
  // a separate problem, and db-deploy.sh already fails on it.
  return readFileSync(join(process.cwd(), 'scripts/migrations.sh'), 'utf8')
    .split('\n')
    .map((line) => line.match(/"([0-9_a-z]+\.sql)\|/)?.[1])
    .filter((name): name is string => Boolean(name))
}

function keysToProfiles(table: string): number {
  const migrations = join(process.cwd(), 'supabase/migrations')

  let count = 0
  for (const file of migrationFiles()) {
    const sql = readFileSync(join(migrations, file), 'utf8')
    // `<column> uuid references public.profiles` in a create or an alter.
    const inCreate = sql.matchAll(
      new RegExp(`create table public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'g'),
    )
    for (const [, body] of inCreate) {
      count += [...body.matchAll(/references\s+public\.profiles/g)].length
    }
    const inAlter = sql.matchAll(
      new RegExp(`alter table public\\.${table}\\b([\\s\\S]*?);`, 'g'),
    )
    for (const [, body] of inAlter) {
      count += [...body.matchAll(/references\s+public\.profiles/g)].length
    }
  }
  return count
}

describe('PostgREST embeds name their foreign key when they have to', () => {
  it('rooms has more than one route to profiles, so this is not hypothetical', () => {
    // If this ever drops back to one, the rule below stops applying to rooms —
    // and this says so rather than the assertion silently passing for a new
    // reason.
    expect(keysToProfiles('rooms')).toBeGreaterThan(1)
  })

  it('every profiles embed on an ambiguous table names its constraint', () => {
    for (const { table, body } of queries()) {
      if (!body.includes('profiles')) continue
      if (keysToProfiles(table) < 2) continue

      expect(body, `${table} embeds profiles without naming which key`).toMatch(
        /profiles!\w+_fkey/,
      )
    }
  })

  it('actually looks at the rooms query, which is the one that broke', () => {
    /*
     * The meta-assertion, and it earned its place immediately: the first
     * version of the rule above paired `.from` with `.select` using a bounded
     * regex, and the comment sitting between them in `getRoom` is longer than
     * the bound — so the rooms query was never matched and the rule passed
     * vacuously on the exact query it exists for. A green check over the bug it
     * was written for is worse than no check.
     */
    const tables = queries().map((q) => q.table)
    expect(tables, 'the source scan no longer sees the rooms query').toContain('rooms')

    const rooms = queries().find((q) => q.table === 'rooms')!
    expect(rooms.body, 'the rooms query stopped embedding profiles').toContain('profiles')
  })

  it('names a constraint that actually exists in a migration', () => {
    // A disambiguated embed is only as good as the name in it: a wrong
    // constraint fails exactly like no constraint at all, and just as loudly.
    const named = [...source.matchAll(/profiles!(\w+_fkey)/g)].map((m) => m[1])
    expect(named.length, 'the rooms embed should be disambiguated').toBeGreaterThan(0)

    const allSql = migrationFiles()
      .map((file) => readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8'))
      .join('\n')

    for (const constraint of named) {
      // Postgres names these `<table>_<column>_fkey`, so the column has to be
      // one the migrations really declare as a reference to profiles.
      const match = constraint.match(/^([a-z]+)_([a-z_]+)_fkey$/)
      expect(match, `${constraint} is not a shape Postgres would generate`).not.toBeNull()

      const column = match![2]
      expect(
        allSql,
        `nothing declares ${column} as a reference to profiles`,
      ).toMatch(new RegExp(`${column}\\s+uuid\\s+references\\s+public\\.profiles`))
    }
  })
})
