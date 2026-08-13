/**
 * Re-cut the two derived copies of the artwork from the master.
 *
 *   node scripts/cut-artwork.mjs
 *
 * There are three copies of one picture and each has a job: the master in
 * `assets/`, served to nobody; the 1200×630 crop Next attaches as the share
 * card; and the 1600×840 the landing page shows at the foot. Replace one of
 * them on its own and the three quietly stop being the same picture — which is
 * exactly what happened when a new export landed in `public/` alone, leaving
 * every link anybody pasted previewing the old artwork.
 *
 * So: put the new export at `assets/thewallopengraph.png` and run this. It is
 * the same command `lib/brand/artwork.test.ts` runs to check the committed
 * files, so a clean run here is a passing test there.
 */
import sharp from 'sharp'

export const MASTER = 'assets/thewallopengraph.png'

/** Every copy cut from the master, and what each is for. */
export const CUTS = [
  { path: 'app/opengraph-image.png', width: 1200, height: 630, why: 'the share card' },
  { path: 'public/thewallopengraph.png', width: 1600, height: 840, why: 'the landing poster' },
]

/** One pipeline, so the test and the script cannot disagree about the bytes. */
export function cut(width, height) {
  return sharp(MASTER)
    .resize(width, height, { fit: 'cover' })
    .png({ quality: 90, compressionLevel: 9 })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const { path, width, height, why } of CUTS) {
    const info = await cut(width, height).toFile(path)
    console.log(`${path}  ${info.width}x${info.height}  ${Math.round(info.size / 1024)} KB  — ${why}`)
  }
}
