import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CUTS, MASTER, cut } from '@/scripts/cut-artwork.mjs'

/**
 * Three copies of one picture, and a way to know they still are.
 *
 * `assets/thewallopengraph.png` is the master — full size, served to nobody,
 * kept so the other two can be made again. `app/opengraph-image.png` is the
 * 1200×630 crop Next attaches as the share card. `public/thewallopengraph.png`
 * is the 1600×840 poster at the foot of the landing page.
 *
 * A new export arrived as `public/thewallopengraph.png` alone — same filename,
 * straight into the served slot — and the other two went on being the previous
 * artwork. The card is the one that matters most and the one nobody looks at,
 * so every link anybody pasted would have previewed a picture that had been
 * replaced. Nothing failed. The page looked right, because the page shows the
 * copy that was updated.
 *
 * `sharp` is deterministic for a given version and set of options, so this does
 * not measure whether the three *look* alike — it re-cuts them and compares the
 * bytes. Same picture or a failing test, with no threshold to argue about.
 *
 * **If this fails after a `sharp` upgrade**, that is the encoder changing
 * rather than the artwork, and the fix is the same either way: run the script
 * and commit what it writes.
 */

describe('the artwork exists three times, and is one picture', () => {
  it('has a master to cut from', () => {
    const master = readFileSync(join(process.cwd(), MASTER))
    expect(master.length).toBeGreaterThan(200_000)
    // Wider than anything cut from it, or the crops are upscales.
    expect(master.readUInt32BE(16)).toBeGreaterThan(1600)
  })

  for (const { path, width, height, why } of CUTS) {
    it(`cuts ${path} from it — ${why}`, async () => {
      const committed = readFileSync(join(process.cwd(), path))
      expect(committed.readUInt32BE(16), `${path} width`).toBe(width)
      expect(committed.readUInt32BE(20), `${path} height`).toBe(height)

      const fresh = await cut(width, height).toBuffer()
      expect(
        fresh.equals(committed),
        `${path} is not the current artwork — run: node scripts/cut-artwork.mjs`,
      ).toBe(true)
    }, 30_000)
  }

  it('keeps the card small enough for a chat app to wait for it', () => {
    /*
     * 1.91:1 is what every scraper crops to, and the ones that give up on a
     * large image are the chat apps — where a pasted link either previews in a
     * second or never does. The master is over a megabyte; the card must not be.
     */
    const card = readFileSync(join(process.cwd(), 'app/opengraph-image.png'))
    expect(card.length).toBeLessThan(400_000)
  })
})
