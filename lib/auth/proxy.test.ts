import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { config } from '@/proxy'

/**
 * What the session refresher runs in front of, and what it does not.
 *
 * The proxy exists to keep an access token alive: without it, an hour after
 * signing up the *server* stops recognising somebody and asks their name again
 * for an account they already have. So the cost of getting this matcher wrong
 * is a silent failure an hour later, to somebody who is not looking at the
 * code — which is why the list is asserted rather than read.
 *
 * The other half is what it must not run in front of. Every path below with
 * `false` is a page with no session on it, reached by strangers and crawlers:
 * the landing page, the documents, the sitemap. An auth round trip there is a
 * round trip to Supabase before a static page can be served, on exactly the
 * URLs built to be hit cold and at volume.
 */

const matcher = (Array.isArray(config.matcher) ? config.matcher : [config.matcher]) as string[]
const covers = (path: string) => matcher.some((pattern) => new RegExp(`^${pattern}$`).test(path))

describe('the session refresher', () => {
  it('runs on everything that can carry a session', () => {
    // The shell, wherever you are standing in it, and the routes that mint or
    // end one. Miss any of these and the token quietly stops being refreshed.
    for (const path of [
      '/',
      '/commons',
      '/music',
      '/music/12',
      '/~marisol',
      '/lobby',
      '/api/signup',
      '/api/login',
      '/auth/callback',
      '/unsubscribe',
      // The trap in writing the exclusions as prefixes: a room whose name
      // merely starts with one of them is still a room, and somebody standing
      // in it still has a session to keep alive.
      '/aboutish',
      '/hellothere',
      '/termsandconditions',
    ]) {
      expect(covers(path), `${path} must be covered`).toBe(true)
    }
  })

  it('stays out of the way of pages nobody is signed in to', () => {
    for (const path of [
      '/hello',
      '/about',
      '/terms',
      '/privacy',
      '/sitemap.xml',
      '/robots.txt',
      '/manifest.webmanifest',
      '/sw.js',
    ]) {
      expect(covers(path), `${path} must not be covered`).toBe(false)
    }
  })

  it('stays out of the way of assets and cards, which have no cookies', () => {
    for (const path of [
      '/_next/static/chunk.js',
      '/favicon.ico',
      '/icon.svg',
      '/opengraph-image.png',
      '/commons/opengraph-image',
      '/music/12/opengraph-image',
    ]) {
      expect(covers(path), `${path} must not be covered`).toBe(false)
    }
  })

  it('is one matcher, so there is one place to get this wrong', () => {
    const source = readFileSync(join(process.cwd(), 'proxy.ts'), 'utf8')
    expect(source).toContain('getUser()')
    expect(matcher).toHaveLength(1)
  })
})
