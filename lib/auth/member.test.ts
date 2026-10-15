import { describe, expect, it } from 'vitest'
import { hasSession } from '@/lib/auth/member'

/**
 * Which page the bare domain shows: /hello to somebody new, commons to somebody
 * with an account on this browser. See app/page.tsx.
 */
const c = (name: string, value = 'x') => ({ name, value })

describe('whether this browser has signed in here', () => {
  it('yes, for the session cookie @supabase/ssr writes', () => {
    expect(hasSession([c('sb-abcdefgh-auth-token')])).toBe(true)
  })

  it('yes, when it is split into chunks because it was too long for one', () => {
    expect(hasSession([c('sb-abcdefgh-auth-token.0'), c('sb-abcdefgh-auth-token.1')])).toBe(true)
  })

  it('no, with no cookies at all — a stranger, or a crawler', () => {
    expect(hasSession([])).toBe(false)
  })

  it('no, half-way through a sign-in, which leaves only a code verifier', () => {
    expect(hasSession([c('sb-abcdefgh-auth-token-code-verifier')])).toBe(false)
  })

  it('no, for a session cookie that was cleared to empty on logout', () => {
    expect(hasSession([c('sb-abcdefgh-auth-token', '')])).toBe(false)
  })

  it('no, for cookies that only look a bit like it', () => {
    expect(hasSession([c('thewall.theme'), c('auth-token'), c('sb-auth-token-backup')])).toBe(false)
  })
})
