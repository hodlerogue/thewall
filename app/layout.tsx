import type { Metadata, Viewport } from 'next'
import { DEFAULT_THEME, themeCss } from '@/lib/shell/themes'
import './globals.css'

export const metadata: Metadata = {
  /*
   * Required for the share cards, not decoration. Next emits og:image as a
   * relative path without it, and every crawler rejects a relative og:image —
   * so the card would build, deploy, and never once be shown.
   *
   * Falls back to the real domain rather than localhost, because the value that
   * gets baked into a production build is the one that matters and an unset
   * variable should not silently publish links to a machine under your desk.
   */
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://thewall.social'),
  title: 'thewall.social',
  description: 'a place you navigate by typing.',
  openGraph: {
    type: 'website',
    siteName: 'thewall.social',
    title: 'thewall.social',
    description: 'a place you navigate by typing.',
  },
  // Without this the card is shown small and square, which throws away the
  // thing it is for — the post is unreadable at 120px.
  twitter: { card: 'summary_large_image' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // maximumScale is deliberately absent. Pinning it to 1 blocks pinch zoom on
  // Android (WCAG 1.4.4), and it was only there to stop iOS zooming on focus —
  // which the 16px prompt now handles properly.
  // The shell manages its own height against visualViewport; letting the
  // browser resize the layout viewport instead would fight it.
  interactiveWidget: 'resizes-content',
  themeColor: '#14100c',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* suppressHydrationWarning because the script below deliberately changes
       data-theme before React hydrates — that is the whole point of it, and
       without this every load logs a mismatch. It suppresses the warning for
       this element's attributes only, not for the tree. */
    <html lang="en" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
        {/* Applied before first paint. Reading it in an effect instead would
            flash the default palette on every load for anyone who chose
            another, which is what makes a site feel provisional. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('thewall.theme');if(t)document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
