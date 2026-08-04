import { ImageResponse } from 'next/og'
import { MARK_BLOCK, MARK_CHEVRON, MARK_GROUND, MARK_INK } from '@/lib/brand/mark'

/**
 * The home-screen icon, for anyone who saves this to a phone.
 *
 * iOS will not take an SVG, so the same mark is rasterised here at build time.
 * It renders the shapes as inline SVG through a data URI rather than as
 * transformed elements: next/og lays out a CSS subset with its own transform
 * origins, and the first attempt at building the chevron from two rotated bars
 * produced a neat X — right at a glance in the source, wrong on the screen.
 *
 * iOS also applies its own rounding and no transparency, so the ground runs to
 * the edges here rather than relying on the rounded rectangle the favicon draws.
 */

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${MARK_GROUND}"/>
  <path d="${MARK_CHEVRON}" fill="none" stroke="${MARK_INK}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <rect ${MARK_BLOCK} fill="${MARK_INK}"/>
</svg>`

export default function AppleIcon() {
  return new ImageResponse(
    (
      <img
        width={size.width}
        height={size.height}
        src={`data:image/svg+xml;utf8,${encodeURIComponent(MARK)}`}
        alt=""
      />
    ),
    size,
  )
}
