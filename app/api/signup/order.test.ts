import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The order of two calls, checked by reading the file.
 *
 * Unusual, and worth it: this is a bug no suite here can see. GoTrue keeps one
 * token per user per type, so minting a second magic link for the same person
 * overwrites the first — and signup mints two, one to consume for the session
 * and one to email. Get them the wrong way round and the key is invalidated
 * before the message is sent. Every account ever created got a dead link, on
 * every attempt, and the only visible symptom was "that key had already been
 * used, or it expired" — on a link a minute old.
 *
 * Nothing else would notice it come back. The unit tests run on fixtures, the
 * e2e suite runs on fixtures, and the database tests never touch GoTrue. This
 * is the cheapest honest guard available.
 */

const source = readFileSync(join(__dirname, 'route.ts'), 'utf8')

describe('signup mints its two links in the order that works', () => {
  it('consumes one for the session before minting the one it emails', () => {
    const session = source.indexOf('sessionLink')
    const key = source.indexOf('keyLink')
    const verify = source.indexOf('verifyOtp')

    expect(session, 'sessionLink is minted').toBeGreaterThan(-1)
    expect(key, 'keyLink is minted').toBeGreaterThan(-1)

    // Session link first, spent, and only then the key that goes in the inbox.
    expect(session).toBeLessThan(verify)
    expect(verify).toBeLessThan(key)
  })

  it('sends the mail after the key is minted, not before', () => {
    expect(source.indexOf('keyLink')).toBeLessThan(source.indexOf('sendMagicLink('))
  })

  it('verifies the token as the type it was minted as', () => {
    // `generateLink({ type: 'magiclink' })` then `verifyOtp({ type: 'email' })`
    // is a mismatch that fails in a way indistinguishable from an expired link.
    expect(source).toMatch(/generateLink\(\{\s*\n?\s*type: 'magiclink'/)
    expect(source).toMatch(/verifyOtp\(\{\s*\n?\s*type: 'magiclink'/)
    expect(source).not.toMatch(/verifyOtp\(\{\s*\n?\s*type: 'email'/)
  })

  it('never mints more than the two it needs', () => {
    // A third would invalidate whichever of these was current.
    expect(source.match(/generateLink\(/g) ?? []).toHaveLength(2)
  })
})
