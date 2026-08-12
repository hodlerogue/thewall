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
  /*
   * The front door is a fixed image and the rest are generated, which is why
   * this one has a `.png` on it: Next serves a static card at its own filename.
   * Everything below it is drawn from the same `Line[]` the shell renders, and
   * the point of listing both here is that they have to be indistinguishable to
   * a crawler — same status, same type, same 1200×630.
   */
  ['the front door', '/opengraph-image.png'],
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

    /*
     * The tag that vanishes without a sound.
     *
     * A generated card exports `alt` from its module; the fixed one takes it
     * from `opengraph-image.alt.txt` sitting beside the file. Misname that by a
     * character and nothing fails — no warning, no build error, the tag is
     * simply absent, and the only place you would notice is a screen reader on
     * somebody else's timeline.
     */
    const alt = await content('meta[property="og:image:alt"]')
    expect(alt, `og:image:alt on ${path}`).toBeTruthy()
    expect(alt, `og:image:alt on ${path} has a stray newline in it`).toBe(alt!.trim())
  }
})

test('following the bare domain lands on the fixed card, not a room’s', async ({ page }) => {
  /*
   * The bug this exists for, end to end.
   *
   * `/` does not render — it redirects to commons (§3.10 puts you there), and a
   * crawler follows the redirect and scrapes the destination. So
   * `app/opengraph-image.png` was never once what a link to the bare domain
   * previewed as: X would have shown whatever was being said in commons that
   * hour, cached for a week, long after every one of those posts had expired.
   *
   * Nothing failed. The tags were present, the image was 1200×630, the alt text
   * was there — every assertion above passed, on a page nobody sharing the
   * domain ever reaches. This walks the redirect the way a crawler does and
   * compares the bytes.
   */
  await page.goto('/')

  const card = await page.locator('meta[property="og:image"]').first().getAttribute('content')
  expect(card, 'no card on the page the domain redirects to').toBeTruthy()

  const followed = await (await page.request.get(new URL(card!).pathname + new URL(card!).search)).body()
  const fixed = await (await page.request.get('/opengraph-image.png')).body()

  expect(followed.equals(fixed), 'the domain previews as something other than the drawn card').toBe(
    true,
  )
})

test('and every other room still previews as itself', async ({ page }) => {
  // The split is the point: commons is the front door and gets the poster,
  // because a card of things that expire in 24 hours is stale for six of the
  // seven days it is cached. A room that keeps what is said in it does not have
  // that problem, and what is being said there is the argument for turning up.
  const fixed = await (await page.request.get('/opengraph-image.png')).body()

  for (const room of ['/music', '/poker', '/feed']) {
    const body = await (await page.request.get(`${room}/opengraph-image`)).body()
    expect(body.equals(fixed), `${room} is showing the poster`).toBe(false)
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

/*
 * What a crawler is handed.
 *
 * Measured against the built site before any of this: `/music` and `/music/12`
 * returned **two words** of HTML — the loading line — with the same title and
 * description as every other URL, and `/` and `/lobby` contained zero `<a href>`
 * between them. Everything is fetched in the browser, so a search engine got an
 * empty prompt and no second page to visit.
 *
 * These assert the three halves of the fix, and they are browser tests rather
 * than unit ones for a reason: the only thing that settles this is what comes
 * back over HTTP before a line of JavaScript runs.
 */

/** The document as a robot sees it: no scripts, no styles, no tags. */
async function asRead(page: Page, path: string) {
  const html = await (await page.request.get(path)).text()
  const body = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
  return {
    html,
    title: /<title>(.*?)<\/title>/s.exec(html)?.[1],
    description: /<meta name="description" content="(.*?)"\/?>/s.exec(html)?.[1],
    words: body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean),
    links: [...html.matchAll(/<a [^>]*href="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((href) => !href.startsWith('#')),
  }
}

test('a room and a post carry their content in the HTML', async ({ page }) => {
  const room = await asRead(page, '/music')
  expect(room.words.length, 'the room is still a loading line').toBeGreaterThan(40)
  expect(room.words.join(' ')).toContain('found my dad’s records')

  const post = await asRead(page, '/music/12')
  expect(post.words.length).toBeGreaterThan(40)
  expect(post.words.join(' '), 'the replies are missing').toContain('warped ones still play')
})

test('and a title and description of their own', async ({ page }) => {
  // Every URL used to answer `thewall.social` with the same sentence under it.
  // Three hundred rooms indistinguishable to a crawler is a deduplication
  // problem rather than a ranking one.
  const room = await asRead(page, '/music')
  const post = await asRead(page, '/music/12')

  expect(room.title).toBe('music — thewall.social')
  expect(post.title).not.toBe(room.title)
  expect(room.description).not.toBe(post.description)
  for (const page_ of [room, post]) {
    expect(page_.description!.length).toBeGreaterThan(20)
    // Google shows about 155 characters and cuts the rest mid-word.
    expect(page_.description!.length).toBeLessThanOrEqual(160)
  }
})

test('and there is a way to walk from one to the next', async ({ page }) => {
  /*
   * The deeper half. Navigation is a command prompt, so `go music` leaves no
   * trace a robot can follow — server-rendering every room would have changed
   * nothing about discovery on its own.
   */
  const lobby = await asRead(page, '/lobby')
  expect(lobby.links, 'the lobby links nowhere').toContain('/music')
  expect(lobby.links.length).toBeGreaterThan(5)

  const room = await asRead(page, '/music')
  expect(room.links).toContain('/music/12')

  const post = await asRead(page, '/music/12')
  expect(post.links, 'a post is a dead end').toContain('/music')
})

test('the sitemap names the rooms, and leaves out the one that keeps nothing', async ({ page }) => {
  const xml = await (await page.request.get('/sitemap.xml')).text()

  expect(xml).toContain('<loc>https://thewall.social/music</loc>')
  expect(xml).toContain('<loc>https://thewall.social/about</loc>')
  // commons is gone in 24 hours and a crawl comes back in days, so every visit
  // would find a different room and none of it the room that was indexed.
  expect(xml, 'commons is being offered for indexing').not.toContain('/commons')
})

test('robots allows the site and points at the sitemap', async ({ page }) => {
  const robots = await (await page.request.get('/robots.txt')).text()

  expect(robots).toContain('Sitemap: https://thewall.social/sitemap.xml')
  expect(robots).toContain('Allow: /')
  // The one path that must never be crawled: following a key spends it.
  expect(robots).toContain('Disallow: /auth/')
})

test('nothing indexable is hidden from the people reading it', async ({ page }) => {
  /*
   * The line between progressive enhancement and cloaking. What a crawler gets
   * is what somebody with JavaScript switched off gets, and it is visible —
   * text clipped to a pixel or set to display:none would be the other thing.
   */
  await page.route('**/*', (route) => route.continue())
  await page.setContent(await (await page.request.get('/music')).text())

  const readable = page.locator('.readable').first()
  await expect(readable).toBeVisible()
  const box = await readable.boundingBox()
  expect(box!.height).toBeGreaterThan(20)
  expect(box!.width).toBeGreaterThan(100)
})
