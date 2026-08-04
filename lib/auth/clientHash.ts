import { createHash } from 'node:crypto'

/**
 * Identifies a caller for rate limiting, without storing who they are.
 *
 * `x-forwarded-for` is only trustworthy from the right end. Proxies *append*,
 * so the leftmost entry is whatever the client sent — reading it, as this used
 * to, meant a fresh header value bought a fresh budget and the limit counted
 * spoofed strings rather than people. Netlify's own header is not forgeable
 * from outside, so it wins where present; otherwise take the last hop, which
 * is the one our proxy actually observed.
 */
export function clientHash(request: Request): string {
  const trusted = request.headers.get('x-nf-client-connection-ip')

  const forwarded = request.headers.get('x-forwarded-for') ?? ''
  const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean)

  const address = trusted?.trim() || hops.at(-1) || 'unknown'
  return createHash('sha256').update(address).digest('hex')
}
