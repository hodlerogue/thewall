import { expect, test, type Page } from '@playwright/test'

/**
 * §4.5 made a choice, and the accessibility work that should have been there
 * from the start.
 */

const prompt = (page: Page) => page.getByTestId('prompt-input')
const scrollback = (page: Page) => page.getByTestId('scrollback')

async function type(page: Page, text: string) {
  await prompt(page).fill(text)
  await prompt(page).press('Enter')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('prompt-label')).toBeVisible()
})

test('theme lists what there is, and marks the one you have', async ({ page }) => {
  await type(page, 'theme')
  for (const name of ['warm', 'black', 'green', 'light']) {
    await expect(scrollback(page)).toContainText(name)
  }
  await expect(scrollback(page)).toContainText('(yours)')
})

test('theme black changes the ground, and survives a reload', async ({ page }) => {
  const ground = () =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor)

  const before = await ground()
  await type(page, 'theme black')

  await expect
    .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe('black')

  const after = await ground()
  expect(after).not.toBe(before)
  expect(after).toBe('rgb(0, 0, 0)')

  // Chosen once, kept — and applied before paint, not after.
  await page.reload()
  await expect(page.getByTestId('prompt-label')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('black')
  expect(await ground()).toBe('rgb(0, 0, 0)')
})

test('a theme that does not exist is answered the way a missing room is', async ({ page }) => {
  await type(page, 'theme blak')
  await expect(scrollback(page)).toContainText('did you mean black?')

  await type(page, 'theme zzzz')
  await expect(scrollback(page)).toContainText('try: theme')
})

test('every result is announced, without reading forty lines aloud', async ({ page }) => {
  const announcer = page.getByTestId('announcer')
  await expect(announcer).toHaveAttribute('aria-live', 'polite')

  await type(page, 'leave')
  // A room listing is many lines; the announcement is a summary plus location.
  await expect(announcer).toContainText('more lines')
  await expect(announcer).toContainText('lobby')

  await type(page, 'go music')
  await expect(announcer).toContainText('music')
})

test('the prompt tells a screen reader where it is (§3.1, WCAG 2.5.3)', async ({ page }) => {
  await type(page, 'leave')
  await type(page, 'go music')

  const visible = await page.getByTestId('prompt-label').innerText()
  const accessible = await prompt(page).getAttribute('aria-label')

  // The visible label must be contained in the accessible name, or voice
  // control cannot address it and a screen reader never learns the location.
  expect(accessible).toContain(visible)
  expect(accessible).toContain('command')
})

test('the scrollback can be reached and scrolled with a keyboard', async ({ page }) => {
  const scrollbackEl = page.getByTestId('scrollback')
  await expect(scrollbackEl).toHaveAttribute('tabindex', '0')
  await expect(scrollbackEl).toHaveAttribute('role', 'log')
  await expect(scrollbackEl).toHaveAttribute('aria-label', /.+/)
})

test('the prompt is 16px, so iOS does not zoom on focus', async ({ page }) => {
  const size = await prompt(page).evaluate((el) => getComputedStyle(el).fontSize)
  expect(size).toBe('16px')
})

test('pinch zoom is not blocked', async ({ page }) => {
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content')
  expect(viewport ?? '').not.toContain('maximum-scale=1')
})

test('the manifest is real, and points at icons that exist', async ({ page }) => {
  // A manifest that 404s, or one naming an icon that does, is a site that
  // silently never offers to install — with nothing on screen to say so.
  const manifest = await page.request.get('/manifest.webmanifest')
  expect(manifest.status()).toBe(200)

  const body = (await manifest.json()) as {
    name: string
    start_url: string
    display: string
    icons: { src: string; sizes: string; type: string }[]
  }
  expect(body.display).toBe('standalone')
  expect(body.start_url).toBe('/')

  for (const icon of body.icons) {
    const response = await page.request.get(icon.src)
    expect(response.status(), icon.src).toBe(200)
    expect(response.headers()['content-type'], icon.src).toContain('image/png')

    const bytes = await response.body()
    expect(bytes.subarray(1, 4).toString('ascii'), icon.src).toBe('PNG')
    // The size it claims is the size it is — a launcher picks by the manifest
    // and then draws what it actually got.
    const [width] = icon.sizes.split('x').map(Number)
    expect(bytes.readUInt32BE(16), `${icon.src} width`).toBe(width)
  }
})

test('the page links to the manifest, or nothing ever reads it', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1)
})

test('install is a command you can find, not a banner you have to dismiss', async ({ page }) => {
  await page.goto('/music')

  // Nothing interrupts. The browser's own mini-infobar is suppressed precisely
  // so this is asked for rather than pushed.
  await expect(page.locator('.scrollback')).not.toContainText('home screen')

  await type(page, 'help')
  await expect(scrollback(page)).toContainText('install — keep this on your home screen')

  await type(page, 'what install')
  await expect(scrollback(page)).toContainText('full screen')
  // Chromium in the test browser has no prompt to replay, so this is the
  // fallback path — and it must still say something useful rather than nothing.
  await type(page, 'install')
  await expect(scrollback(page)).toContainText(/menu|home screen/)
})


test('somebody who has just arrived is told where to find out what this is', async ({ page }) => {
  // A command prompt on a social site raises a question that neither `help` nor
  // `what` answers: they say what you can type, not what this is.
  await page.goto('/')
  await expect(scrollback(page)).toContainText('new here? type about.')

  await type(page, 'about')
  await expect(scrollback(page)).toContainText('no feed, no likes and no algorithm')
  // And it says where the rest of it lives, rather than being a dead end.
  await expect(scrollback(page)).toContainText('/about')
})

test('the rundown is a page, readable without typing anything', async ({ page }) => {
  await page.goto('/about')

  await expect(page.locator('h1')).toHaveText('thewall')
  await expect(page.locator('body')).toContainText('entire interface is a command prompt')
  await expect(page.locator('body')).toContainText('commons')

  // The command list is generated from the registry, which is the whole reason
  // this page is allowed to exist — a hand-written one would drift away from
  // what `help` prints and leave two answers to one question.
  for (const verb of ['say', 'go', 'look', 'make', 'find', 'mail', 'install']) {
    await expect(page.locator('.glossary'), verb).toContainText(verb)
  }
  // §4.8 — the pipe is still not advertised, here or anywhere.
  await expect(page.locator('.glossary')).not.toContainText('| count')

  // And it leads back to the prompt and to the policies.
  await expect(page.locator('a[href="/"]')).toBeVisible()
  await expect(page.locator('a[href="/terms"]')).toBeVisible()
  await expect(page.locator('a[href="/privacy"]')).toBeVisible()
})

test('hints off quiets the instructions, and survives a reload', async ({ page }) => {
  /*
   * "Not sure people want to be constantly given instructions. There should be
   * a setting that allows you to turn that off for sure."
   *
   * Kept on by default and switchable, because §3.6's argument for teaching is
   * about the first ten minutes: somebody who has not learned the site cannot
   * know to ask for help, and somebody who has can type four characters.
   */
  await page.goto('/music')
  await type(page, 'go 12')
  await expect(scrollback(page)).toContainText('reply <something> answers the post')

  await type(page, 'hints off')
  await expect(scrollback(page)).toContainText('hints off')

  await type(page, 'look')
  await type(page, 'go 12')
  // The thread is still there; the line telling you how to answer it is not.
  await expect(scrollback(page)).toContainText('warped ones still play')
  const teaching = scrollback(page).locator('.line', {
    hasText: 'reply <something> answers the post',
  })
  await expect(teaching).toHaveCount(1) // the one printed before it was switched off

  // Per browser, like the theme — so a reload has to remember, including the
  // boot lines, which are printed before any command runs.
  await page.reload()
  await expect(page.getByTestId('prompt-label')).toBeVisible()
  await expect(scrollback(page)).not.toContainText('type look to see what’s around you')
  await expect(scrollback(page)).toContainText('thewall.social')
})

test('and quiets nothing that was said, nor any error', async ({ page }) => {
  /*
   * The two things the filter must never reach. An error is the answer to
   * something you just did, and content is the entire product — a setting that
   * ate either would be a worse bug than the nagging it fixes.
   *
   * The third kind, a line reporting content you cannot see, needs a room
   * bigger than the demo has; `lib/shell/hints.test.ts` asserts that one
   * against `older`, the lobby's count and mail's cap directly.
   */
  await page.goto('/commons')
  await type(page, 'hints off')

  await type(page, 'go nowhere-at-all')
  await expect(scrollback(page)).toContainText('there’s no room called')

  // commons stops announcing what commons is, and still shows what is in it.
  const banner = scrollback(page).locator('.line', { hasText: 'commons keeps nothing' })
  await expect(banner, 'the room did not announce itself on arrival').toHaveCount(1)

  await type(page, 'look')
  await expect(scrollback(page)).toContainText('the AC in my building')
  // Still one: the arrival printed it before hints were switched off, and
  // nothing rewrites what is already on the screen.
  await expect(banner).toHaveCount(1)
})

test('hints on brings them back', async ({ page }) => {
  await page.goto('/music')
  await type(page, 'hints off')
  await type(page, 'hints on')
  await type(page, 'go 12')
  await expect(scrollback(page)).toContainText('reply <something> answers the post')
})
