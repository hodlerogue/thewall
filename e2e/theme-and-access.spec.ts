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
