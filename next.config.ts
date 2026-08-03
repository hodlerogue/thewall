import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    // The mobile gate suite drives the dev server over 127.0.0.1.
    '127.0.0.1',
    // Codespaces serves the dev server from a forwarded subdomain, which Next
    // treats as cross-origin and blocks by default. Without these, the page
    // loads and then quietly fails to hydrate — which looks like a broken app
    // rather than a config problem.
    '*.app.github.dev',
    '*.githubpreview.dev',
  ],
  // The dev badge sits exactly where the prompt does on a 380px viewport.
  devIndicators: false,
}

export default nextConfig
