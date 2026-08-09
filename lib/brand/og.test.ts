import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { truncateForCard } from '@/lib/brand/og'
import { DEFAULT_ROOM } from '@/lib/shell/env'
import { FRONT_DOOR } from '@/lib/shell/types'

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

describe('the card at the front door', () => {
  /*
   * A picture somebody drew, not a picture the site drew.
   *
   * This was generated like the others — three seeded rooms and what was last
   * said in them, on the §3.11 argument that proof of life is what decides
   * whether anybody clicks. That argument still holds for a *room* and a
   * *post*, which is why those cards are still built from the same `Line[]` the
   * shell renders. It holds less well for the front door, where the question is
   * not "what is being said here" but "what is this", and a card showing three
   * rooms answers the second one only by accident.
   *
   * So the root card is a fixed image, and what it costs is the thing worth
   * writing down: nothing regenerates it. Change the palette, the prompt or the
   * chips and the room cards follow; this one does not, and there is no test
   * that could notice. It is a poster, and posters go stale.
   */
  const card = join(process.cwd(), 'app/opengraph-image.png')

  it('is where Next looks for it, next to its alt text', () => {
    // The file convention is the whole wiring: `app/opengraph-image.png` becomes
    // og:image for `/` and everything under it without a card of its own, and
    // `.alt.txt` becomes og:image:alt. Misname either and nothing fails — the
    // tag is simply absent, which is invisible until somebody pastes a link.
    expect(existsSync(card)).toBe(true)
    const alt = readFileSync(join(process.cwd(), 'app/opengraph-image.alt.txt'), 'utf8')
    expect(alt.length).toBeGreaterThan(20)
    // Read raw and used raw — Next does not trim it, so a trailing newline goes
    // straight into the `og:image:alt` attribute and out to every crawler.
    expect(alt).toBe(alt.trim())
  })

  it('is 1200×630, which is what every scraper crops to', () => {
    /*
     * Read out of the PNG header rather than trusted. 1.91:1 is the shape
     * Facebook, LinkedIn, Slack and Twitter all assume; hand them something
     * else and they crop from the centre, which takes the wordmark off one
     * edge and the terminal off the other.
     */
    const header = readFileSync(card).subarray(16, 24)
    expect([header.readUInt32BE(0), header.readUInt32BE(4)]).toEqual([1200, 630])
  })

  it('is small enough that the scrapers with a budget will fetch it', () => {
    /*
     * The source is 1.1 MB at 1731×909. Most crawlers would take it; the ones
     * that would not are the chat apps, where a link gets pasted and the
     * preview either appears in a second or does not appear at all. There is no
     * error when a scraper gives up — the card is just missing.
     */
    expect(readFileSync(card).byteLength).toBeLessThan(300_000)
  })

  it('is the only card at the root, or the build picks one and says nothing', () => {
    // Next takes `opengraph-image.*` by convention; a leftover generator beside
    // the image is a coin toss over which one ships.
    const beside = readdirSync(join(process.cwd(), 'app')).filter((name) =>
      /^opengraph-image\.(tsx|ts|jsx|js)$/.test(name),
    )
    expect(beside).toEqual([])
  })
})

describe('the front door redirects, so its card is not its own', () => {
  /*
   * The whole of the bug this section exists for: `/` does not render. It
   * redirects to commons (§3.10 puts you there), and a crawler follows the
   * redirect and scrapes *that* page — so `app/opengraph-image.png` is never
   * once what a link to the bare domain previews as. It was found by watching a
   * `curl` against the built site, not by anything failing.
   *
   * The fix is that commons serves the same fixed card, which makes the room
   * name a load-bearing constant in two files that have no other reason to
   * agree.
   */
  const page = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8')
  const card = readFileSync(join(process.cwd(), 'app/[room]/opengraph-image.tsx'), 'utf8')

  it('sends the bare domain to the room the card is pinned to', () => {
    expect(page).toContain('FRONT_DOOR')
    expect(page).toMatch(/redirect\(.*FRONT_DOOR/s)
    expect(card).toContain('slug === FRONT_DOOR')
  })

  it('and that room is the one the shell opens in, in all four spellings', () => {
    /*
     * `FRONT_DOOR`, the fixtures' `DEFAULT_ROOM`, and the copy `Shell.tsx`
     * declares for itself. Drift here is silent in the worst way: the redirect
     * would point at one room and the fixed card at another, so the domain
     * would preview as whatever is being said in a room nobody chose.
     */
    const shell = readFileSync(join(process.cwd(), 'components/Shell.tsx'), 'utf8')
    const declared = /const DEFAULT_ROOM = '([a-z-]+)'/.exec(shell)?.[1]

    expect(FRONT_DOOR).toBe(DEFAULT_ROOM)
    expect(declared, 'Shell no longer declares one — drop this assertion').toBe(FRONT_DOOR)
  })

  it('reads the fixed card off disk, which the build has to be told about', () => {
    // `outputFileTracingIncludes` is the only thing putting the PNG in the
    // serverless bundle: Next cannot trace a path built from `process.cwd()`,
    // and the failure shows up in production only, as a card that 500s.
    expect(card).toMatch(/readFile\(join\(process\.cwd\(\), 'app', 'opengraph-image\.png'\)\)/)
    const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8')
    expect(config).toMatch(/'\/\[room\]\/opengraph-image':[^\]]*opengraph-image\.png/)
  })
})

describe('a room and a post still draw themselves', () => {
  it('so the cards that show content are still generated from it', () => {
    // The front door is a poster now; these two are not, and that split is the
    // point. A link to `music/12` previews the conversation, which is the only
    // argument for opening it (§3.11).
    expect(existsSync(join(process.cwd(), 'app/[room]/opengraph-image.tsx'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'app/[room]/[postId]/opengraph-image.tsx'))).toBe(true)
  })
})
