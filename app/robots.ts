import type { MetadataRoute } from 'next'

/**
 * Nothing was disallowed before this file existed, and nothing is now — what
 * changes is that the sitemap has somewhere to be announced.
 *
 * There is no link graph on this site (navigation is a command prompt, so `/`
 * has no `<a href>` at all), which makes the sitemap the only way anything gets
 * discovered, which makes this line the thing that makes the sitemap useful.
 *
 * The two paths ruled out are the two that are not pages. `/auth/callback`
 * spends a single-use sign-in key on whoever opens it — a crawler following one
 * out of an inbox would burn it — and `/api/*` answers no crawler usefully.
 * `/unsubscribe` is left alone deliberately: it carries a token, so it must
 * never be indexed, and it says so with `noindex` on the page itself rather
 * than here, where naming it would publish the shape of the URL.
 */
export default function robots(): MetadataRoute.Robots {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://thewall.social'

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/auth/'],
    },
    sitemap: `${site.replace(/\/$/, '')}/sitemap.xml`,
  }
}
