import { ImageResponse } from 'next/og'
import { MARK_BLOCK, MARK_CHEVRON, MARK_GROUND, MARK_INK } from '@/lib/brand/mark'

/**
 * The mark as a PNG at whatever size a manifest asks for.
 *
 * A manifest wants 192 and 512, and it wants PNG: SVG icons in a manifest are
 * accepted by some browsers and quietly ignored by others, which for an install
 * icon means finding out on somebody else's phone.
 *
 * Drawn through a data URI rather than as elements, for the reason
 * `app/apple-icon.tsx` records: next/og lays out a CSS subset with its own
 * transform origins, and building the chevron from two rotated bars renders a
 * neat X — correct-looking in the source and wrong on the screen.
 */
export function pngIcon(size: number): ImageResponse {
  const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${MARK_GROUND}"/>
  <path d="${MARK_CHEVRON}" fill="none" stroke="${MARK_INK}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <rect ${MARK_BLOCK} fill="${MARK_INK}"/>
</svg>`

  return new ImageResponse(
    (
      <img
        width={size}
        height={size}
        src={`data:image/svg+xml;utf8,${encodeURIComponent(mark)}`}
        alt=""
      />
    ),
    { width: size, height: size },
  )
}
