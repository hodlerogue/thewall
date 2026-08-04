import { expect, test, type Page } from '@playwright/test'

/**
 * §3.4 — "thewall.sh/music/12 is the same address as the prompt. Shareable
 * URLs fall out of the design at zero cost."
 *
 * True of the address, and not of the preview. A link to a conversation that
 * previews as a bare domain is a link nobody opens, so the card is where that
 * claim is either honoured or quietly abandoned.
 *
 * The failure this suite is really guarding is silent: a card that 500s, or a
 * relative og:image, looks identical to a working one from inside the app. You
 * find out when somebody pastes a link and nothing appears.
 */

const CARDS = [
  ['the front door', '/opengraph-image'],
  ['a room', '/music/opengraph-image'],
  ['a post', '/music/12/opengraph-image'],
  ['commons', '/commons/opengraph-image'],
  // Every one of these is somewhere a crawler can plausibly land, and each has
  // to answer with an image rather than an error.
  ['a post that is gone', '/music/999/opengraph-image'],
  ['a room that never was', '/nowhere/opengraph-image'],
  ['somebody’s wall, which is a room with an owner', '/~marisol/opengraph-image'],
  ['a post on a wall', '/~marisol/2/opengraph-image'],
  ['a name nobody has', '/~nobodyatall/opengraph-image'],
  ['a post id that is not a number', '/music/abc/opengraph-image'],
] as const

test('every card is a real image, at the size the crawlers want', async ({ page }) => {
  for (const [what, url] of CARDS) {
    const response = await page.request.get(url)
    expect(response.status(), `${what} — ${url}`).toBe(200)
    expect(response.headers()['content-type'], what).toContain('image/png')

    const body = await response.body()
    // PNG magic, then the IHDR width and height. Cheaper and stricter than
    // decoding: 1200×630 is what every platform crops against.
    expect(body.subarray(1, 4).toString('ascii'), what).toBe('PNG')
    expect(body.readUInt32BE(16), `${what} width`).toBe(1200)
    expect(body.readUInt32BE(20), `${what} height`).toBe(630)
  }
})

test('the page points at its card, absolutely', async ({ page }) => {
  const content = async (selector: string) =>
    page.locator(selector).first().getAttribute('content')

  for (const path of ['/', '/music', '/music/12']) {
    await page.goto(path)

    const image = await content('meta[property="og:image"]')
    // A relative og:image is rejected by every crawler there is, which is what
    // metadataBase exists to prevent — and the only visible symptom is a link
    // that never previews.
    expect(image, `og:image on ${path}`).toMatch(/^https?:\/\//)
    expect(await content('meta[property="og:image:width"]'), path).toBe('1200')
    expect(await content('meta[property="og:image:height"]'), path).toBe('630')

    // Small-and-square would throw away the whole point: the post is
    // unreadable at 120px.
    expect(await content('meta[name="twitter:card"]'), path).toBe('summary_large_image')
    expect(await content('meta[property="og:title"]'), path).toBeTruthy()
  }
})

test('the card for a post is the post, not a generic picture', async ({ page }) => {
  // Rendered text cannot be read back out of a PNG, so this checks the thing
  // that actually distinguishes them: a card built from real content differs
  // from the fallback, and two different posts differ from each other.
  const bytes = async (url: string) => (await page.request.get(url)).body()

  const post = await bytes('/music/12/opengraph-image')
  const other = await bytes('/poker/4/opengraph-image')
  const missing = await bytes('/music/999/opengraph-image')

  expect(post.equals(missing)).toBe(false)
  expect(post.equals(other)).toBe(false)
})

test('a card is stable, so a shared link does not change under it', async ({ page }) => {
  const once = await (await page.request.get('/music/12/opengraph-image')).body()
  const twice = await (await page.request.get('/music/12/opengraph-image')).body()
  expect(once.equals(twice)).toBe(true)
})
