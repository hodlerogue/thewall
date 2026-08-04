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

const original = process.env.NEXT_PUBLIC_SITE_URL

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://thewall.social'
})
afterEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = original
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

  it('follows the configured origin, since that is what the cookie is set on', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://thewallsocial.netlify.app'
    expect(verifyUrl('t')).toContain('https://thewallsocial.netlify.app/auth/callback')
  })
})
