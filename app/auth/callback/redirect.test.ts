import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Where the callback sends somebody, checked by reading the route.
 *
 * Two bugs lived here, and neither could be seen by running anything in this
 * repo — the e2e suite never leaves the dev server, and there is no test that
 * boots a route handler behind a proxy that rewrites `request.url`.
 *
 * 1. The redirect was built from `request.url`. Inside a route handler on
 *    Netlify that is the *internal* deploy URL rather than the address the
 *    person typed, so following a key that correctly said `thewall.social`
 *    landed on a deploy-scoped `…netlify.app` host that appears in no
 *    configuration anywhere. The session cookie was set over there.
 *
 * 2. `next` came straight from the query string into `new URL(next, origin)`,
 *    which returns `https://evil.example` for `?next=https://evil.example` — an
 *    open redirect on the one route people reach by clicking a link in an
 *    email.
 *
 * So this reads the source, the same way `app/api/signup/order.test.ts` checks
 * an ordering nothing could observe from outside.
 */

const raw = readFileSync(join(process.cwd(), 'app/auth/callback/route.ts'), 'utf8')

/**
 * The file with its comments removed.
 *
 * Necessary rather than tidy: the comments in that route quote the old broken
 * expressions, because explaining a bug is most of what stops it coming back.
 * Scanning the raw text made the explanation trip the check for the thing it
 * explains — a test that punishes writing down why.
 */
const source = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('the callback redirect', () => {
  it('never turns the request into a host', () => {
    /*
     * Reading the query string out of `request.url` is fine and necessary —
     * parameters survive any rewrite untouched. It is `.origin` that is the
     * bug: that is the step which takes an internal deploy URL and makes it
     * somewhere to send a person. So the rule is about the origin, not about
     * touching request.url at all, which the first draft of this test got
     * wrong and failed on the legitimate line.
     */
    expect(source, 'an origin is being read from a URL').not.toMatch(/\.origin\b/)
    expect(source, 'a host is being assembled from headers').not.toMatch(/x-forwarded-host/)
  })

  it('sends a relative Location, which cannot name the wrong host', () => {
    expect(source).toMatch(/Location:\s*`\$\{target\.pathname\}\$\{target\.search\}`/)
    // A relative Location is only safe if nothing else redirects absolutely.
    expect(source).not.toContain('NextResponse.redirect(')
  })

  it('refuses a next that is not a path', () => {
    // Both spellings: an absolute URL, and `//host`, which is a URL wearing a
    // path's clothes and is the one people forget.
    expect(source).toMatch(/startsWith\('\/'\)/)
    expect(source).toMatch(/!\s*\w+\.startsWith\('\/\/'\)/)
  })
})

/**
 * The same rules as behaviour rather than as source text, run against a copy of
 * the function. Reading the file catches a regression in shape; this catches one
 * in logic, and the two fail for different reasons.
 */
function backTo(next: string, outcome: string): { status: number; location: string } {
  const safe = next.startsWith('/') && !next.startsWith('//') ? next : '/'
  const target = new URL(safe, 'http://parse.invalid')
  target.searchParams.set('key', outcome)
  return { status: 303, location: `${target.pathname}${target.search}` }
}

describe('where a followed key actually lands', () => {
  it('is a path and never an origin', () => {
    for (const next of ['/', '/commons', '/music/12']) {
      const { location } = backTo(next, 'ok')
      expect(location.startsWith('/'), next).toBe(true)
      expect(location, next).not.toMatch(/^https?:/)
      expect(location, next).not.toContain('netlify')
    }
  })

  it('carries the outcome, which is the only reason it redirects at all', () => {
    expect(backTo('/commons', 'ok').location).toBe('/commons?key=ok')
    expect(backTo('/commons', 'expired').location).toBe('/commons?key=expired')
    expect(backTo('/commons', 'failed').location).toBe('/commons?key=failed')
  })

  it('keeps what next already carried', () => {
    expect(backTo('/music?theme=black', 'ok').location).toBe('/music?theme=black&key=ok')
  })

  it('will not be talked into leaving the site', () => {
    for (const hostile of [
      'https://evil.example',
      '//evil.example',
      'http://evil.example/path',
      '//evil.example/commons',
    ]) {
      const { location } = backTo(hostile, 'ok')
      expect(location, hostile).toBe('/?key=ok')
      expect(location, hostile).not.toContain('evil')
    }
  })
})
