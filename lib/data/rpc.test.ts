import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every RPC the client calls has to exist, with the argument names it passes.
 *
 * This is the one class of defect the other three suites structurally cannot
 * see. The unit tests run against fixtures, the e2e suite runs against
 * fixtures, and the database tests call the functions from SQL rather than
 * through the client — so a function renamed in a migration, or a parameter
 * called `p_name` where the caller says `name`, compiles, passes everything,
 * deploys, and fails as a 404 from PostgREST in front of a real person.
 *
 * PostgREST resolves an RPC by name *and* by the exact set of argument names,
 * which is why the arguments are checked and not just the function.
 */

const ROOT = join(__dirname, '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(path)
  }
  return out
}

interface Call {
  file: string
  fn: string
  args: string[]
}

function callSites(): Call[] {
  const calls: Call[] = []
  // `.rpc('name')` or `.rpc('name', { p_a: …, p_b: … })`. The argument object is
  // matched shallowly, which is all these call sites ever are.
  const pattern = /\.rpc\(\s*'([a-z_]+)'\s*(?:,\s*\{([^}]*)\})?/g

  for (const dir of ['lib', 'app', 'components']) {
    for (const file of walk(join(ROOT, dir))) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(pattern)) {
        const args = (match[2] ?? '')
          .split(',')
          .map((pair) => pair.split(':')[0].trim())
          .filter(Boolean)
        calls.push({ file: file.slice(ROOT.length + 1), fn: match[1], args })
      }
    }
  }
  return calls
}

/** Every function the migrations define, mapped to its declared parameters. */
function declared(): Map<string, Set<string>> {
  const functions = new Map<string, Set<string>>()
  const dir = join(ROOT, 'supabase', 'migrations')

  for (const name of readdirSync(dir).sort()) {
    const sql = readFileSync(join(dir, name), 'utf8')
    const pattern = /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_]+)\s*\(([^)]*)\)/gi
    for (const match of sql.matchAll(pattern)) {
      const params = new Set(
        match[2]
          .split(',')
          .map((param) => param.trim().split(/\s+/)[0])
          .filter((word) => word.startsWith('p_')),
      )
      // A later migration replacing a function wins, exactly as applying them
      // in order does.
      functions.set(match[1], params)
    }
  }
  return functions
}

describe('the client and the schema agree', () => {
  const calls = callSites()
  const schema = declared()

  it('finds the call sites at all, so a passing suite means something', () => {
    expect(calls.length).toBeGreaterThan(5)
    expect(schema.size).toBeGreaterThan(5)
  })

  it('calls only functions the migrations create', () => {
    for (const call of calls) {
      expect(schema.has(call.fn), `${call.file} calls ${call.fn}()`).toBe(true)
    }
  })

  it('passes only arguments those functions declare', () => {
    for (const call of calls) {
      const params = schema.get(call.fn)
      if (!params) continue
      for (const arg of call.args) {
        expect([...params], `${call.file}: ${call.fn}(${arg})`).toContain(arg)
      }
    }
  })

  it('passes every argument that has no default', () => {
    // A missing required argument is the same PostgREST 404 as a misspelled
    // one, and reads identically in a browser console.
    const required = new Map<string, string[]>([
      ['create_post', ['p_room', 'p_body']],
      ['change_name', ['p_name']],
      ['name_changed_hands', ['p_name']],
      ['record_signup_attempt', ['p_client_hash']],
      ['record_attempt', ['p_kind', 'p_client_hash']],
    ])

    for (const call of calls) {
      for (const param of required.get(call.fn) ?? []) {
        expect(call.args, `${call.file}: ${call.fn} needs ${param}`).toContain(param)
      }
    }
  })
})
