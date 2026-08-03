import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The mobile gate suite drives the dev server over 127.0.0.1.
  allowedDevOrigins: ['127.0.0.1'],
  // The dev badge sits exactly where the prompt does on a 380px viewport.
  devIndicators: false,
}

export default nextConfig
