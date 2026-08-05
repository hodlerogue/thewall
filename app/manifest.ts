import type { MetadataRoute } from 'next'
import { MARK_GROUND } from '@/lib/brand/mark'

/**
 * What a phone needs before it will offer to keep this.
 *
 * `display: 'standalone'` is the whole point of installing: no address bar, no
 * browser chrome, and — the part that actually matters here — the keyboard
 * behaves the way `components/Terminal.tsx` already assumes it does, because
 * the viewport stops being shared with a browser UI that resizes on scroll.
 *
 * `start_url` is `/`, not `/lobby`. §3.10 puts arrivals in commons and `/` is
 * the front door that does it; starting at the lobby would give somebody who
 * installed this a different first screen from everybody else.
 *
 * The colours are `warm` from lib/shell/themes.ts and deliberately fixed, for
 * the same reason the favicon is: this is chrome, not content. A splash screen
 * that changed with a preference stored inside the app would flash the wrong
 * colour every launch, since it is drawn before any of that is read.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'thewall.social',
    short_name: 'thewall',
    description: 'a social site where the whole interface is a command prompt',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: MARK_GROUND,
    theme_color: MARK_GROUND,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // `maskable` is what stops Android drawing the mark inside a white circle
      // it did not ask for. The mark's ground already runs to the edges, so the
      // same file works for both.
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
