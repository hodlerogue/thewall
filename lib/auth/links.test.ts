import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { verifyUrl } from '@/lib/auth/links'

/**
 * The link in the email is the only way anybody gets back in on a second
 * device, and it was wrong in a way nothing could see.
 *
 * `generateLink()` returns an `action_link` pointing at Supabase's own verify
 * endpoint, which bounces back with the session in a URL **fragment** — and a
 * fragment is never sent to a server. So the callback saw no token, did
 * nothing, and redirected; the only sessions anybody ever had came from signup
 * consuming a separate link server-side.
 */

const original = {
  site: process.env.NEXT_PUBLIC_SITE_URL,
  url: process.env.URL,
  prime: process.env.DEPLOY_PRIME_URL,
  deploy: process.env.DEPLOY_URL,
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://thewall.social'
  // Netlify sets these; the tests below set them deliberately, so start clean.
  delete process.env.URL
  delete process.env.DEPLOY_PRIME_URL
  delete process.env.DEPLOY_URL
})
afterEach(() => {
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  restore('NEXT_PUBLIC_SITE_URL', original.site)
  restore('URL', original.url)
  restore('DEPLOY_PRIME_URL', original.prime)
  restore('DEPLOY_URL', original.deploy)
})

describe('the key in the email', () => {
  it('points at our own callback, not at supabase', () => {
    const url = new URL(verifyUrl('abc123'))
    expect(url.origin).toBe('https://thewall.social')
    expect(url.pathname).toBe('/auth/callback')
  })

  it('carries the token where a server can read it', () => {
    // The whole bug in one assertion: a query parameter reaches the route, a
    // fragment does not.
    const url = new URL(verifyUrl('abc123'))
    expect(url.searchParams.get('token_hash')).toBe('abc123')
    expect(url.hash).toBe('')
  })

  it('says which kind of token it is', () => {
    // The callback used to hardcode 'email' while links were minted as
    // magiclink — a mismatch that fails quietly and reads as an expired link.
    expect(new URL(verifyUrl('abc123')).searchParams.get('type')).toBe('magiclink')
    expect(new URL(verifyUrl('abc123', 'recovery')).searchParams.get('type')).toBe('recovery')
  })

  it('escapes a token rather than pasting it in', () => {
    const token = 'a+b/c=d&e'
    expect(new URL(verifyUrl(token)).searchParams.get('token_hash')).toBe(token)
  })

  it('follows the configured origin when there is no request to read', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://thewallsocial.netlify.app'
    expect(verifyUrl('t')).toContain('https://thewallsocial.netlify.app/auth/callback')
  })
})

/**
 * The bug this suite could not see, because it only ever asked about the
 * configured value.
 *
 * A deploy on a custom domain with NEXT_PUBLIC_SITE_URL still pointing at its
 * `netlify.app` address emailed every key to the wrong origin. Following one
 * ran the callback there, set the session cookie there, and left you on the
 * real site as a stranger being asked for a name you had already chosen — and
 * `resend`, which needs a session, answered "you're not signed in".
 */
const asking = (host: string, proto = 'https') =>
  new Request(`${proto}://${host}/api/signup`, { headers: { host, 'x-forwarded-proto': proto } })

describe('which origin a key comes back to', () => {
  it('returns somebody to the site they are actually using', () => {
    // The platform vouches for the custom domain, so a signup that happened
    // there gets a link back there — whatever the build-time constant says.
    process.env.NEXT_PUBLIC_SITE_URL = 'https://thewallsocial.netlify.app'
    process.env.URL = 'https://thewall.social'

    expect(verifyUrl('t', 'magiclink', asking('thewall.social'))).toContain(
      'https://thewall.social/auth/callback',
    )
  })

  it('still works on the netlify address, since previews are a real place to be', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://thewall.social'
    process.env.DEPLOY_PRIME_URL = 'https://deploy-preview-7--thewall.netlify.app'

    expect(
      verifyUrl('t', 'magiclink', asking('deploy-preview-7--thewall.netlify.app')),
    ).toContain('https://deploy-preview-7--thewall.netlify.app/auth/callback')
  })

  it('refuses an origin nothing vouches for, which would be account takeover', () => {
    /*
     * The reason this is an allowlist and not "just use the Host header".
     * Post a signup for somebody else's address with a forged Host and they are
     * emailed a working key pointing at your server; they click it, and you
     * have their token. So an unrecognised origin falls back rather than being
     * trusted.
     */
    process.env.NEXT_PUBLIC_SITE_URL = 'https://thewall.social'

    const link = verifyUrl('t', 'magiclink', asking('evil.example'))
    expect(link).toContain('https://thewall.social/auth/callback')
    expect(link).not.toContain('evil.example')
  })

  it('reads the platform’s own value when nothing else is configured', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL
    process.env.URL = 'https://thewall.social'
    expect(verifyUrl('t', 'magiclink', asking('thewall.social'))).toContain('https://thewall.social')
  })
})
