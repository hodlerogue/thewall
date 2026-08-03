import { expect, test, type Page } from '@playwright/test'

/**
 * The Phase 1 gate (§4.4, §8).
 *
 * These assertions are the go/no-go for the whole concept: if the prompt cannot
 * hold its position and the palette cannot be used with a thumb, the design
 * fails on the only device that matters for a social product.
 */

/** The palette is labelled "commands", so match the textbox role exactly. */
const prompt = (page: Page) => page.getByRole('textbox', { name: 'command' })

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
