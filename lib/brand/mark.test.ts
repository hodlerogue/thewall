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

describe('the manifest, which is what a phone reads before offering to keep this', () => {
  it('has everything an install prompt requires', async () => {
    const { default: manifest } = await import('@/app/manifest')
    const m = manifest()

    // Chrome will not offer to install without these. Each absent one is a
    // silent no-offer rather than an error, which is why they are listed.
    expect(m.name).toBeTruthy()
    expect(m.short_name).toBeTruthy()
    expect(m.start_url).toBe('/')
    expect(m.display).toBe('standalone')

    const sizes = (m.icons ?? []).map((icon) => icon.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
  })

  it('has a maskable icon, or android draws it inside a circle it did not ask for', () => {
    return import('@/app/manifest').then(({ default: manifest }) => {
      const purposes = (manifest().icons ?? []).map((icon) => icon.purpose)
      expect(purposes).toContain('maskable')
    })
  })

  it('starts at the front door, not the lobby', async () => {
    // §3.10 puts arrivals in commons and `/` is what does it. Starting an
    // installed copy at /lobby would give it a different first screen from
    // every other way in.
    const { default: manifest } = await import('@/app/manifest')
    expect(manifest().start_url).toBe('/')
  })

  it('is drawn in the same colours as the icon', async () => {
    const { default: manifest } = await import('@/app/manifest')
    const { MARK_GROUND } = await import('@/lib/brand/mark')
    // The splash screen is painted before any preference can be read, so a
    // theme-aware value here would flash the wrong colour on every launch.
    expect(manifest().background_color).toBe(MARK_GROUND)
    expect(manifest().theme_color).toBe(MARK_GROUND)
  })
})

describe('the service worker', () => {
  it('exists, and caches nothing', () => {
    // Comments stripped first. The file explains at length why it does not call
    // respondWith, and scanning the raw text made that explanation fail the
    // check for the thing it explains — the same trap as
    // `app/auth/callback/redirect.test.ts`, which is why that one strips too.
    const source = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    // Present, because Chrome's install criteria have wanted a fetch handler.
    expect(source).toContain("addEventListener('fetch'")
    /*
     * And empty, because every screen here is either live or a few hundred
     * bytes. A cache-first worker would trade a saving nobody would notice for
     * the classic failure where a deploy goes out and people keep running last
     * week's JavaScript against this week's database.
     */
    expect(source).not.toContain('caches.open')
    expect(source).not.toContain('respondWith')
  })
})
