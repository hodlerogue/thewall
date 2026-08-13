import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { landingPath } from '@/lib/auth/links'

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
    expect(source).toMatch(/Location:\s*landingPath\(/)
    // A relative Location is only safe if nothing else redirects absolutely.
    expect(source).not.toContain('NextResponse.redirect(')
  })

  it('does not sanitise the next itself', () => {
    /*
     * It used to, inline, and the guard had a hole — see `landingPath`. The
     * rule now lives in one place with its reasoning beside it, and this
     * refuses a second copy growing back in the route.
     */
    expect(source).toMatch(/landingPath\(/)
    expect(source, 'the guard is back in the route').not.toMatch(/startsWith\('\/\/'\)/)
  })
})

/**
 * The same rules as behaviour rather than as source text.
 *
 * This used to hold a *copy* of the guard and try four hostile inputs — all of
 * them ones somebody writing the guard would think of first. So the copy and
 * the code agreed with each other about a rule that was wrong, which is the
 * failure mode of testing a duplicate: it does not catch a bug, it seconds it.
 * The function is imported now.
 */
describe('where a followed key actually lands', () => {
  const backTo = (next: string, outcome: string) => landingPath(next, { key: outcome })

  it('is a path and never an origin', () => {
    for (const next of ['/', '/commons', '/music/12']) {
      const location = backTo(next, 'ok')
      expect(location.startsWith('/'), next).toBe(true)
      expect(location, next).not.toMatch(/^https?:/)
      expect(location, next).not.toContain('netlify')
    }
  })

  it('carries the outcome, which is the only reason it redirects at all', () => {
    expect(backTo('/commons', 'ok')).toBe('/commons?key=ok')
    expect(backTo('/commons', 'expired')).toBe('/commons?key=expired')
    expect(backTo('/commons', 'failed')).toBe('/commons?key=failed')
  })

  it('keeps what next already carried', () => {
    expect(backTo('/music?theme=black', 'ok')).toBe('/music?theme=black&key=ok')
  })

  it('will not be talked into leaving the site', () => {
    /*
     * The last four are the ones the previous guard let through, and the reason
     * it did is worth keeping written down: it tested the string as it arrived.
     * `/..//evil.example` starts with a single slash and passes — and then the
     * URL parser resolves the `..` away and leaves a pathname of
     * `//evil.example`, which a browser follows off-site. Every failure path in
     * the callback redirects too, so no valid token was ever needed.
     */
    for (const hostile of [
      'https://evil.example',
      '//evil.example',
      'http://evil.example/path',
      '//evil.example/commons',
      '/..//evil.example',
      '/./..//evil.example',
      '/a/b/../../..//evil.example',
      'javascript:alert(1)',
    ]) {
      const location = backTo(hostile, 'ok')
      expect(location, hostile).not.toContain('evil')
      expect(location, hostile).not.toMatch(/^\/\//)
      expect(location, hostile).not.toMatch(/^[a-z][a-z0-9+.-]*:/i)
      expect(location.startsWith('/'), hostile).toBe(true)
    }
  })

  it('answers with a path for anything at all, rather than throwing', () => {
    // Somebody following a link from their inbox must not meet a 500 because
    // the query string was rubbish.
    for (const junk of ['', 'http://[', '%%%', '/\\evil.example']) {
      expect(backTo(junk, 'ok').startsWith('/'), junk).toBe(true)
    }
  })
})
