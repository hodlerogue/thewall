import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MARK_BLOCK, MARK_CHEVRON, MARK_GROUND, MARK_INK } from '@/lib/brand/mark'

/**
 * The two icons have to stay the same mark.
 *
 * `app/icon.svg` is a static file because browsers want an SVG favicon, and
 * `app/apple-icon.tsx` rasterises because iOS will not take one — so the shapes
 * exist in two places by necessity. Nothing else would notice them diverging:
 * a favicon that quietly stops matching the home-screen icon is the kind of
 * thing you find out about a year later, from somebody else.
 */

const favicon = readFileSync(join(__dirname, '..', '..', 'app', 'icon.svg'), 'utf8')

describe('the favicon', () => {
  it('is drawn from the shared mark', () => {
    expect(favicon).toContain(MARK_CHEVRON)
    expect(favicon).toContain(MARK_BLOCK)
    expect(favicon).toContain(MARK_GROUND)
    expect(favicon).toContain(MARK_INK)
  })

  it('is square, and sized for a tab rather than for a page', () => {
    expect(favicon).toContain('viewBox="0 0 32 32"')
    // No width/height beyond the box would leave some browsers guessing.
    expect(favicon).toMatch(/width="32"/)
    expect(favicon).toMatch(/height="32"/)
  })

  it('carries its own ground, so it is legible on a light or dark tab strip', () => {
    // A transparent favicon disappears into whichever tab strip it lands in,
    // and the two are opposite colours across browsers and themes.
    expect(favicon).toContain(`fill="${MARK_GROUND}"`)
  })

  it('stays small enough that it is never worth a second thought', () => {
    expect(favicon.length).toBeLessThan(2000)
  })
})
