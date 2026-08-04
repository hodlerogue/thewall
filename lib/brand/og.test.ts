import { describe, expect, it } from 'vitest'
import { truncateForCard } from '@/lib/brand/og'

/**
 * The share card is a fixed rectangle, so a line that does not fit is not
 * scrolled — it is cut, mid-word, with no signal that anything was lost.
 *
 * The indent is the part that got this wrong: a flat width looked correct on a
 * post body and clipped a reply, because §3.2 puts a reply body two steps in
 * and nothing had taken those steps out of the budget.
 */

const FITS = 'x'.repeat(59)

describe('a line on the card', () => {
  it('is left alone when it fits', () => {
    expect(truncateForCard(FITS, 0)).toBe(FITS)
    expect(truncateForCard('short', 0)).toBe('short')
  })

  it('is cut with an ellipsis when it does not', () => {
    const cut = truncateForCard('y'.repeat(80), 0)
    expect(cut).toHaveLength(59)
    expect(cut.endsWith('…')).toBe(true)
  })

  it('loses room to its own indentation', () => {
    // Every step in costs characters, or the text runs past the right edge
    // while the arithmetic says it fits.
    const flush = truncateForCard('z'.repeat(80), 0).length
    const one = truncateForCard('z'.repeat(80), 1).length
    const two = truncateForCard('z'.repeat(80), 2).length

    expect(one).toBeLessThan(flush)
    expect(two).toBeLessThan(one)
  })

  it('cuts a reply body that fits flush but not two steps in', () => {
    // The exact line that shipped clipped: 57 characters, at depth 2.
    const reply = 'warped ones still play, they just wobble. it grows on you.'
    expect(reply).toHaveLength(58)
    expect(truncateForCard(reply, 0)).toBe(reply)
    expect(truncateForCard(reply, 2).endsWith('…')).toBe(true)
  })

  it('never leaves a trailing space before the ellipsis', () => {
    expect(truncateForCard(`${'a'.repeat(58)} tail`, 0)).not.toContain(' …')
  })
})
