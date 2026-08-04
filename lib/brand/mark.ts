/**
 * The mark, as the four values both icons are drawn from.
 *
 * A prompt with the cursor sitting in it: a chevron and a block. Designed for
 * 16px first, which is the only size that really matters — a tab favicon is
 * smaller than most punctuation, so it has to be two shapes rather than a
 * picture. Anything with a wall, bricks or lettering turns to mud there.
 *
 * These live here rather than being written twice because there are two icons
 * and they must not drift: `app/icon.svg` is a static file (browsers prefer an
 * SVG favicon, and it is a few hundred bytes), while `app/apple-icon.tsx`
 * rasterises to PNG because iOS will not take an SVG. `lib/brand/mark.test.ts`
 * asserts the static file still uses these exact values.
 *
 * The colours are `warm` from lib/shell/themes.ts — the default palette, and
 * deliberately fixed rather than theme-aware. A favicon is chrome, not content:
 * it sits in a tab beside other tabs, and its whole job is to be the same shape
 * every time so the tab is findable at a glance.
 */

export const MARK_GROUND = '#14100c'
export const MARK_INK = '#e8a05c'

/** The `>` of a prompt, on a 32×32 viewBox. */
export const MARK_CHEVRON = 'M8 11 L13 16 L8 21'

/** The block cursor waiting after it. */
export const MARK_BLOCK = 'x="17" y="12.5" width="7" height="7.5" rx="1"'
