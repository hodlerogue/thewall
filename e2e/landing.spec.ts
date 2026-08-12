import { expect, test, type Page } from '@playwright/test'

/**
 * /hello — the page you send somebody who has not seen this before.
 *
 * Walked on the phone project, because a landing page that only works at
 * 1280px is a landing page for nobody: §8 makes mobile the kill condition, and
 * a link pasted into a group chat is opened on a phone almost every time.
 *
 * Two things here are guards rather than checks. The demo running the real
 * registry is the entire justification for the component existing, so it is
 * asserted rather than eyeballed. And the samples' colours are asserted
 * because they were wrong once already: `.proof p` matched every `.line`
 * inside a sample — one class more specific than `.line-accent` — and flattened
 * every tone to the same colour, which looks like a slightly dull page rather
 * than like a bug.
 */

const pane = (page: Page) => page.getByTestId('demo-pane')
const input = (page: Page) => page.getByTestId('demo-input')
const label = (page: Page) => page.getByTestId('demo-label')

test('says what this is, in the HTML, before any script runs', async ({ page }) => {
  await page.route('**/*.js', (route) => route.abort())
  await page.goto('/hello')

  await expect(page.getByRole('heading', { level: 1 })).toContainText('command prompt')
  await expect(page.getByRole('link', { name: /open the prompt/ }).first()).toBeVisible()
  // The demo frame is not empty without its JavaScript: the lobby listing is
  // rendered on the server and stands in until the live one replaces it.
  await expect(pane(page)).toContainText('music')
})

test('has one h1, and it is the pitch', async ({ page }) => {
  await page.goto('/hello')
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
})

test('the demo walks itself into a conversation', async ({ page }) => {
  await page.goto('/hello')

  // The script is `go music`, `go 12`, `who` — run through the real runner, so
  // this is the site's own output arriving, not a transcript being replayed.
  await expect(label(page)).toHaveText('guest:music/12$', { timeout: 20_000 })
  await expect(pane(page)).toContainText('found my dad’s records')
  await expect(pane(page)).toContainText('marisol')
})

test('a chip inserts and never runs, and ↵ is what runs it', async ({ page }) => {
  await page.goto('/hello')
  await expect(label(page)).toHaveText('guest:music/12$', { timeout: 20_000 })

  /*
   * §3.6 and §9 — the line between a real interface and a terminal costume. A
   * page selling this one is the last place to blur it, so the chip puts the
   * word at the prompt and stops.
   */
  await page.getByRole('button', { name: /^leave/ }).click()
  await expect(input(page)).toHaveValue('leave')
  await expect(label(page)).toHaveText('guest:music/12$')

  await page.getByTestId('demo-enter').click()
  await expect(label(page)).toHaveText('guest:music$')
  await expect(input(page)).toHaveValue('')
})

test('typing into it works, and the site answers', async ({ page }) => {
  await page.goto('/hello')
  await expect(label(page)).toHaveText('guest:music/12$', { timeout: 20_000 })

  await input(page).fill('help')
  await input(page).press('Enter')
  // `help` lists what you can type from where you are standing — generated
  // from the registry, so this is the real one or nothing.
  await expect(pane(page)).toContainText('go — ')
})

test('the samples are pictures of the interface, in its own colours', async ({ page }) => {
  await page.goto('/hello')

  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  )
  const tones = await page.evaluate(() =>
    [...document.querySelectorAll('.proof-sample .line')].map((line) => ({
      cls: line.className,
      color: getComputedStyle(line).color,
    })),
  )

  const accented = tones.filter((line) => line.cls.includes('line-accent'))
  const faint = tones.filter((line) => line.cls.includes('line-faint'))
  expect(accented.length).toBeGreaterThan(0)
  expect(faint.length).toBeGreaterThan(0)

  const hex = (rgb: string) =>
    `#${(rgb.match(/\d+/g) ?? [])
      .slice(0, 3)
      .map((n) => Number(n).toString(16).padStart(2, '0'))
      .join('')}`

  for (const line of accented) expect(hex(line.color)).toBe(accent.toLowerCase())
  // And the tones are actually different from each other, which is the thing
  // that was broken: every line rendered the same colour and still "had" a
  // class saying otherwise.
  expect(new Set(tones.map((line) => line.color)).size).toBeGreaterThan(2)
})

test('the card is shown with words for anybody who cannot see it', async ({ page }) => {
  await page.goto('/hello')
  const shot = page.locator('.landing-shot')
  await expect(shot).toHaveAttribute('alt', /thewall\.social/)
  await expect(shot).toHaveAttribute('width', '1600')
})

test('the link previews as the card, and the card is really there', async ({ page, request }) => {
  /*
   * The tag this page is most likely to lose.
   *
   * Declaring `openGraph` on a page replaces the layout's, and with it the
   * image Next attaches from the file convention — which is how `/hello` first
   * shipped with no `og:image` at all, no warning anywhere, and nothing to
   * notice it on but somebody else's timeline. So the whole set is asserted,
   * and the URL is followed rather than trusted.
   */
  const response = await page.goto('/hello')
  const html = (await response?.text()) ?? ''

  const tag = (property: string) =>
    html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`))?.[1]

  expect(tag('og:image')).toBeTruthy()
  expect(tag('og:image:width')).toBe('1200')
  expect(tag('og:image:height')).toBe('630')
  // Present, and long enough to be a description rather than a filename.
  expect((tag('og:image:alt') ?? '').length).toBeGreaterThan(60)
  // Deliberately absent everywhere: without it, `?v=2` is enough to make X
  // fetch a card again rather than serve the one it cached a week ago.
  expect(tag('og:url')).toBeUndefined()

  const image = await request.get(new URL(tag('og:image')!).pathname)
  expect(image.status()).toBe(200)
  expect((await image.body()).length).toBeGreaterThan(20_000)
})

test('nothing runs off the side of a phone', async ({ page }) => {
  await page.goto('/hello')
  await expect(label(page)).toHaveText('guest:music/12$', { timeout: 20_000 })

  const overflowing = await page.evaluate(() => {
    const width = document.documentElement.clientWidth

    /*
     * Anything inside something that scrolls sideways is allowed past the edge
     * — that is what a scroller is for, and the palette in the demo is the
     * product's own, mask and all. What is being caught here is a *page* that
     * is wider than the phone: prose that will not wrap, an image without a
     * max-width, a frame with padding it cannot afford.
     */
    const scrolls = (el: Element) => {
      for (let at: Element | null = el; at; at = at.parentElement) {
        const overflow = getComputedStyle(at).overflowX
        if (overflow === 'auto' || overflow === 'scroll') return true
      }
      return false
    }

    return [...document.querySelectorAll('.landing *')]
      .filter((el) => el.getBoundingClientRect().right > width + 1 && !scrolls(el))
      .map((el) => el.className || el.tagName)
      .slice(0, 5)
  })
  expect(overflowing).toEqual([])
})

test('the way out is the product, not a signup', async ({ page }) => {
  await page.goto('/hello')
  await page.getByRole('link', { name: /open the prompt/ }).first().click()
  await expect(page).toHaveURL(/\/commons$/)
})

test('it survives a theme somebody else chose', async ({ page }) => {
  // Nothing on this page may hard-code a colour: the tokens are the contract,
  // and `themes.test.ts` measures those. Black is the furthest palette from
  // the default warm one.
  await page.goto('/hello')
  await page.evaluate(() => {
    localStorage.setItem('thewall.theme', 'black')
  })
  await page.reload()

  const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(ground).toBe('rgb(0, 0, 0)')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})
