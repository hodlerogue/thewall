import { describe, expect, it } from 'vitest'
import { arrivalLines } from '@/lib/data/live'

/**
 * Your own words, coming back at you.
 *
 * Reported from real use:
 *
 *     ryan:music$ say idk about that
 *     music/20
 *
 *     20  ryan, just now
 *     idk about that
 *
 * The post arrived down the realtime channel and printed underneath the
 * confirmation, so everything said in a room appeared twice. The suppression
 * was there and could not work: the caller built the display string first —
 * `20  ryan` — and passed that as the author, so "is this mine" compared
 * `20  ryan` against `ryan`.
 *
 * Commons was the one place it behaved, because there the address is absent,
 * the prefix is empty, and the two strings were accidentally equal. That is
 * also why it survived: the only room anybody tests signup in is commons.
 */

const at = new Date().toISOString()

describe('what arrives live', () => {
  it('says nothing when the words are your own, in a room with addresses', () => {
    // The case that was broken. A room post carries a number, and the number
    // is what used to defeat the comparison.
    expect(arrivalLines({ author: 'ryan', mine: 'ryan', body: 'idk', at, depth: 0, address: 20 })).toEqual([])
  })

  it('and in commons, where there is no number', () => {
    expect(arrivalLines({ author: 'ryan', mine: 'ryan', body: 'idk', at, depth: 0 })).toEqual([])
  })

  it('and for a reply of yours in a post you are standing in', () => {
    expect(arrivalLines({ author: 'ryan', mine: 'ryan', body: 'idk', at, depth: 1 })).toEqual([])
  })

  it('prints somebody else’s post, with its address', () => {
    const lines = arrivalLines({ author: 'marisol', mine: 'ryan', body: 'warped ones still play', at, depth: 0, address: 20 })

    expect(lines).toHaveLength(2)
    expect(lines[0].text).toMatch(/^20 {2}marisol, /)
    expect(lines[1]).toEqual({ text: 'warped ones still play', depth: 1 })
  })

  it('prints somebody else’s commons post without one, because there is none', () => {
    const lines = arrivalLines({ author: 'marisol', mine: 'ryan', body: 'the AC is out', at, depth: 0 })
    expect(lines[0].text).toMatch(/^marisol, /)
    expect(lines[0].text).not.toMatch(/\d+ {2}marisol/)
  })

  it('indents a reply one step further than a post (§3.2)', () => {
    const lines = arrivalLines({ author: 'marisol', mine: 'ryan', body: 'yes', at, depth: 1 })
    expect(lines[0].depth).toBe(1)
    expect(lines[1].depth).toBe(2)
  })

  it('shows everything to a guest, who has no words of their own here', () => {
    const lines = arrivalLines({ author: 'marisol', mine: null, body: 'hello', at, depth: 0, address: 3 })
    expect(lines).toHaveLength(2)
  })

  it('matches on the whole name, not a piece of one', () => {
    // `ryan` and `ryanne` are two people, and neither should silence the other.
    expect(arrivalLines({ author: 'ryanne', mine: 'ryan', body: 'hi', at, depth: 0, address: 4 })).toHaveLength(2)
    expect(arrivalLines({ author: 'ryan', mine: 'ryanne', body: 'hi', at, depth: 0, address: 4 })).toHaveLength(2)
  })
})
