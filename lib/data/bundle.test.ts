import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `supabase/setup.sql` is generated, and a generated file in a repo goes stale.
 *
 * It exists so a new project can be stood up from a browser: paste one file
 * into the SQL editor and the schema, the grants and the §5 seed all land in
 * one transaction. That is worth having, and it has the failure mode every
 * generated artefact has — somebody adds a migration, `db-deploy.sh` picks it
 * up because it reads the directory, and the pasted file quietly builds last
 * month's schema. The site then boots against it and fails on whichever verb
 * the missing migration was for.
 *
 * So the file is regenerated here and compared. A drifted bundle is a failed
 * test rather than a project that comes up subtly wrong.
 */

const ROOT = join(__dirname, '..', '..')

function generated(): string {
  return execFileSync(join(ROOT, 'scripts', 'db-bundle.sh'), { encoding: 'utf8' })
}

describe('the pasteable bundle and the migrations agree', () => {
  const committed = readFileSync(join(ROOT, 'supabase', 'setup.sql'), 'utf8')

  it('is exactly what the script produces today', () => {
    // Not "contains every migration" — that passes while the seed is a month
    // old, and the seed is the half §5 cares about.
    expect(generated()).toBe(committed)
  })

  it('carries every migration, in the order they are applied', () => {
    /*
     * Belt and braces, and they catch different things. The equality above
     * fails if anything drifts; this one says *what* drifted, and it is the
     * assertion that still means something if somebody ever regenerates the
     * file to make the first test pass without reading what changed.
     */
    const migrations = readdirSync(join(ROOT, 'supabase', 'migrations')).sort()
    expect(migrations.length).toBeGreaterThan(10)

    let at = -1
    for (const name of migrations) {
      const found = committed.indexOf(name)
      expect(found, `${name} is not in setup.sql`).toBeGreaterThan(-1)
      expect(found, `${name} is out of order in setup.sql`).toBeGreaterThan(at)
      at = found
    }
  })

  it('records every migration as applied, so a later db-deploy skips them', () => {
    // Otherwise the first `db-deploy.sh` against a bundled project falls back
    // to adopting it by probing — which works only because all the probes
    // happen to be right, and a wrong one re-runs a migration on a schema that
    // already has it.
    const record = committed.slice(committed.indexOf('insert into public.applied_migrations'))
    for (const name of readdirSync(join(ROOT, 'supabase', 'migrations'))) {
      expect(record, `${name} is applied but not recorded`).toContain(`('${name}')`)
    }
  })

  it('lands as one transaction, so half a schema is not a thing that can happen', () => {
    // A partial paste that leaves `rooms` but not `create_post` produces a site
    // that boots, lists rooms, and dies on the first thing anybody types.
    expect(committed).toMatch(/^begin;$/m)
    expect(committed).toMatch(/^commit;$/m)
    expect(committed.indexOf('\nbegin;')).toBeLessThan(committed.indexOf('\ncommit;'))
  })

  it('includes the seed, because a schema with no rooms is not a deployment', () => {
    // §5 — "an empty room is worse than no room. The demo cannot launch to a
    // ghost town." A bundle that stopped at the schema would hand somebody a
    // lobby of nine empty doors.
    const seed = readFileSync(join(ROOT, 'supabase', 'seed.sql'), 'utf8')
    const sentence = 'the AC in my building has been out for three days'
    expect(seed).toContain(sentence)
    expect(committed).toContain(sentence)
  })
})
