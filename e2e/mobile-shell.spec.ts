import { expect, test, type Page } from '@playwright/test'

/**
 * The Phase 1 gate (§4.4, §8).
 *
 * These assertions are the go/no-go for the whole concept: if the prompt cannot
 * hold its position and the palette cannot be used with a thumb, the design
 * fails on the only device that matters for a social product.
 */

/**
 * By test id, not by accessible name. The name now carries the location — the
 * §3.1 claim that a terminal answers "where am I" has to hold for screen
 * readers too — and tests should not be the reason that name is wrong.
 */
const prompt = (page: Page) => page.getByTestId('prompt-input')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // The shell loads its first room before the prompt exists; without waiting,
  // a test can measure the scrollback mid-boot.
  await expect(page.getByTestId('prompt-label')).toBeVisible()
})

test('the shell fits a 380px viewport without horizontal scroll', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('the prompt is visible above the fold on arrival', async ({ page }) => {
  const promptBox = await prompt(page).boundingBox()
  const viewport = page.viewportSize()!
  expect(promptBox).not.toBeNull()
  expect(promptBox!.y + promptBox!.height).toBeLessThanOrEqual(viewport.height)
})

test('the prompt stays put when the visual viewport shrinks like a keyboard', async ({ page }) => {
  const before = (await prompt(page).boundingBox())!

  // Chromium cannot open a real software keyboard, so shrink the visual
  // viewport the way one does and assert the shell tracked it.
  await page.evaluate(() => {
    const vv = window.visualViewport!
    Object.defineProperty(vv, 'height', { value: 380, configurable: true })
    vv.dispatchEvent(new Event('resize'))
  })

  const appHeight = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim(),
  )
  expect(appHeight).toBe('380px')

  const after = (await prompt(page).boundingBox())!
  // The composer rode the viewport up rather than staying under the keyboard.
  expect(after.y).toBeLessThan(before.y)
  expect(after.y + after.height).toBeLessThanOrEqual(380)
})

test('scrollback scrolls independently and the page body does not', async ({ page }) => {
  // Fill the scrollback well past one screen.
  for (let i = 0; i < 6; i++) {
    await prompt(page).fill('look')
    await prompt(page).press('Enter')
  }

  const scrollback = page.getByTestId('scrollback')
  await expect
    .poll(async () => scrollback.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true)

  // The newest output is what you are looking at.
  await expect
    .poll(async () =>
      scrollback.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 4),
    )
    .toBe(true)

  const bodyScrolls = await page.evaluate(
    () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
  )
  expect(bodyScrolls).toBe(false)
})

test('a chip inserts into the prompt and does not execute (§3.6)', async ({ page }) => {
  const scrollback = page.getByTestId('scrollback')
  const linesBefore = await scrollback.locator('p').count()

  await page.locator('.chip[data-verb="say"]').tap()

  await expect(prompt(page)).toHaveValue('say ')
  // Nothing ran: the cursor is waiting, which is the entire point.
  expect(await scrollback.locator('p').count()).toBe(linesBefore)
})

test('chips are reachable with a thumb and stay under ~6 per context', async ({ page }) => {
  const chips = page.locator('.chip')
  const count = await chips.count()
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThanOrEqual(6)

  for (let i = 0; i < count; i++) {
    const box = (await chips.nth(i).boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(30)
  }
})

test('the primary action is on screen without scrolling for it', async ({ page }) => {
  // This is the assertion whose absence certified a broken palette. The old
  // test tapped `say` — and `.tap()` scrolls the element into view first, so a
  // chip sitting off the right edge passed happily. §8 makes mobile the kill
  // condition; the gate has to check what a thumb can actually reach.
  //
  // Measured against the scroller's own box, not the viewport's. The two used
  // to be the same and are not any more: `help` is pinned beside the scroller,
  // so a chip can end inside the window while still being clipped by the strip
  // it lives in — visible to a bounding box and invisible to a person.
  for (const [path, expected] of [
    ['/commons', 'say'],
    ['/music', 'say'],
    ['/lobby', 'look'],
    ['/~marisol', 'go'],
  ] as const) {
    await page.goto(path)
    await expect(page.getByTestId('prompt-label')).toBeVisible()

    const chip = page.locator(`.chip[data-verb="${expected}"]`)
    await expect(chip, `${expected} chip on ${path}`).toBeVisible()

    const box = (await chip.boundingBox())!
    const strip = (await page.locator('.palette').boundingBox())!

    expect(box.x, `${expected} starts inside the strip at ${path}`).toBeGreaterThanOrEqual(strip.x)
    expect(
      box.x + box.width,
      `${expected} ends inside the strip at ${path}`,
    ).toBeLessThanOrEqual(strip.x + strip.width)
  }
})

test('help is on screen everywhere, without scrolling for it', async ({ page }) => {
  // The chip whose entire audience is somebody who does not know what to do
  // must not be the one they have to already know to scroll for. Exactly one
  // chip fits at 380px — a gloss makes each 150–290px wide — so this only
  // holds because `help` is pinned outside the scroller, and this is what says
  // so if anybody ever moves it back in.
  const viewport = page.viewportSize()!

  for (const path of ['/commons', '/music', '/lobby', '/music/12', '/~marisol']) {
    await page.goto(path)
    await expect(page.getByTestId('prompt-label')).toBeVisible()

    const help = page.locator('.chip[data-verb="help"]')
    await expect(help, `help on ${path}`).toBeVisible()

    const box = (await help.boundingBox())!
    expect(box.x, `help starts on screen at ${path}`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `help ends on screen at ${path}`).toBeLessThanOrEqual(viewport.width)
    // Reachable with a thumb, like every other chip.
    expect(box.height, `help is tappable at ${path}`).toBeGreaterThanOrEqual(30)
  }
})

test('help still inserts rather than executing, and still says what it is', async ({ page }) => {
  await page.goto('/commons')
  await expect(page.getByTestId('prompt-label')).toBeVisible()

  const help = page.locator('.chip[data-verb="help"]')
  // The gloss moves to the accessible name when the chip is pinned, so §3.6's
  // glossary rule bends visually and not for a screen reader.
  await expect(help).toHaveAttribute('aria-label', /help — .+/)

  await help.tap()
  await expect(prompt(page)).toHaveValue('help')
  // Inserted, not run (§3.6, §9).
  await expect(page.getByTestId('scrollback')).not.toContainText('from here you can type')

  await prompt(page).press('Enter')
  await expect(page.getByTestId('scrollback')).toContainText('from here you can type')
})

test('the palette changes with context and depth renders as indentation', async ({ page }) => {
  await prompt(page).fill('leave')
  await prompt(page).press('Enter')
  await expect(page.getByTestId('prompt-label')).toHaveText('guest:lobby$')

  await prompt(page).fill('go music')
  await prompt(page).press('Enter')
  await expect(page.getByTestId('prompt-label')).toHaveText('guest:music$')

  await prompt(page).fill('go 12')
  await prompt(page).press('Enter')
  await expect(page.getByTestId('prompt-label')).toHaveText('guest:music/12$')

  // §3.2: replies are indented one step, their bodies two. No box drawing.
  // These are full-width blocks, so the indent lives in padding, not position.
  const indent = (selector: string) =>
    page
      .getByTestId('scrollback')
      .locator(selector)
      .last()
      .evaluate((el) => getComputedStyle(el).paddingLeft)

  expect(await indent('p.depth-1')).toBe('16px')
  expect(await indent('p.depth-2')).toBe('32px')

  // And no `└─` anywhere — depth is position, never characters.
  const scrollbackText = await page.getByTestId('scrollback').innerText()
  expect(scrollbackText).not.toMatch(/[└├│─]/)

  // Long bodies wrap instead of pushing the layout sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
