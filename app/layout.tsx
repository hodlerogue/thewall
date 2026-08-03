import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'thewall.social',
  description: 'a place you navigate by typing.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // The shell manages its own height against visualViewport; letting the
  // browser resize the layout viewport instead would fight it.
  interactiveWidget: 'resizes-content',
  themeColor: '#14100c',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
