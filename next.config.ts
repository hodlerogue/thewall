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

  /*
   * What is actually running, baked in at build time.
   *
   * Netlify sets COMMIT_REF and BRANCH. Without them surfaced somewhere, "is
   * the fix deployed?" is unanswerable from the outside — which turned a code
   * bug and a deploy question into the same symptom, twice, and cost two
   * rounds of diagnosing the wrong thing.
   */
  env: {
    NEXT_PUBLIC_BUILD: (process.env.COMMIT_REF ?? '').slice(0, 7) || 'local',
    NEXT_PUBLIC_BRANCH: process.env.BRANCH ?? '',
  },

  // The share cards read a font off disk at render time, and the per-room and
  // per-post ones are dynamic — so the file has to be inside the serverless
  // bundle. Next traces `readFile` calls it can follow statically; a path built
  // from `process.cwd()` is not one of them, and the failure only shows up in
  // production, as a card that 500s.
  outputFileTracingIncludes: {
    '/opengraph-image': ['./assets/**'],
    '/[room]/opengraph-image': ['./assets/**'],
    '/[room]/[postId]/opengraph-image': ['./assets/**'],
    '/apple-icon': ['./assets/**'],
  },
}

export default nextConfig
