import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canReceiveMail } from '@/lib/auth/deliverable'

/**
 * Never send to an address that cannot receive.
 *
 * Found while working out what a public repository changes about this project.
 * The answer turned out to be a live defect rather than a disclosure: the five
 * accounts `seed.sql` creates live at `@seed.invalid`, a TLD reserved so that
 * it can never resolve, and the site was willing to mail them. Two ways in:
 *
 *   * The daily digest. They are verified, their posts sit in the lobby, and
 *     email is on by default, so the first real answer to jameson puts
 *     `jameson@seed.invalid` in front of the sender — every day there is
 *     something new.
 *   * `login jameson`. The seeded names head seeded posts and are written down
 *     in a readable repository, so anyone can type it.
 *
 * Every one is a hard bounce. Enough of them throttles or suspends a sending
 * domain, and this one has only just been warmed — so the cost is not that the
 * seed accounts miss their mail, it is that nobody else gets a sign-in key.
 */

describe('addresses that can never receive', () => {
  it('refuses the reserved TLDs, which is what the seed uses', () => {
    // RFC 2606 §2 and RFC 6761. There is no DNS behind any of them, by design.
    expect(canReceiveMail('jameson@seed.invalid')).toBe(false)
    expect(canReceiveMail('someone@anything.test')).toBe(false)
    expect(canReceiveMail('someone@anything.example')).toBe(false)
    expect(canReceiveMail('someone@localhost')).toBe(false)
    expect(canReceiveMail('someone@box.localhost')).toBe(false)
  })

  it('refuses the reserved domains, and subdomains of them', () => {
    expect(canReceiveMail('someone@example.com')).toBe(false)
    expect(canReceiveMail('someone@example.net')).toBe(false)
    expect(canReceiveMail('someone@example.org')).toBe(false)
    // The shape people actually type into a signup box when they are testing.
    expect(canReceiveMail('test@mail.example.com')).toBe(false)
  })

  it('is not case-sensitive, because an address is not', () => {
    expect(canReceiveMail('Jameson@Seed.INVALID')).toBe(false)
    expect(canReceiveMail('SOMEONE@EXAMPLE.COM')).toBe(false)
  })

  it('accepts an ordinary address', () => {
    expect(canReceiveMail('ryan@gmail.com')).toBe(true)
    expect(canReceiveMail('someone@thewall.social')).toBe(true)
    // Not reserved, merely unusual. This refuses what cannot resolve, not what
    // looks unfamiliar — guessing at "real" domains is how a filter starts
    // rejecting people with their own mail servers.
    expect(canReceiveMail('someone@invalid-looking.xyz')).toBe(true)
    expect(canReceiveMail('someone@my.invalidish.co.uk')).toBe(true)
  })

  it('refuses something that is not an address at all', () => {
    expect(canReceiveMail('')).toBe(false)
    expect(canReceiveMail('nothing')).toBe(false)
    expect(canReceiveMail('trailing@')).toBe(false)
  })

  it('does not refuse a domain that merely contains a reserved word', () => {
    // `invalid.com` is somebody's domain. `.invalid` is the reserved TLD, and
    // the difference is the whole of what this function has to get right.
    expect(canReceiveMail('someone@invalid.com')).toBe(true)
    expect(canReceiveMail('someone@testing.io')).toBe(true)
    expect(canReceiveMail('someone@example.co')).toBe(true)
  })
})

describe('the routes that send actually ask', () => {
  const login = readFileSync(
    join(__dirname, '..', '..', 'app', 'api', 'login', 'route.ts'),
    'utf8',
  )
  // Comments first — four source-reading guards in this repo have been tripped
  // by prose sitting beside the thing they match.
  const source = login.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  it('login checks before it mints a key', () => {
    expect(source).toContain('canReceiveMail(account.user.email)')
    // Before `generateLink`, not after: minting is what costs, and a key that
    // exists but was never sent is a key somebody could still be waiting for.
    expect(source.indexOf('canReceiveMail')).toBeLessThan(source.indexOf('generateLink'))
  })

  it('and says what happened rather than pretending it sent', () => {
    // The seeded names head seeded posts in the lobby, so there is nothing to
    // protect by being vague — and "your key is on its way" to an address that
    // does not exist leaves somebody waiting for an email that is not coming.
    expect(source).toContain('shipped with')
  })
})
