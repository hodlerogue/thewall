import { expect, test, type Page } from '@playwright/test'

/**
 * The reflexes anyone who has used a terminal arrives with (§4.5).
 *
 * None of these existed — there was no onKeyDown in the codebase at all — and
 * they are the cheapest available purchase of "this is a real interface"
 * rather than a text box wearing one.
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

test('Up walks back through what you typed', async ({ page }) => {
  await type(page, 'look')
  await type(page, 'who')

  await prompt(page).press('ArrowUp')
  await expect(prompt(page)).toHaveValue('who')

  await prompt(page).press('ArrowUp')
  await expect(prompt(page)).toHaveValue('look')

  // And does not walk off the end.
  await prompt(page).press('ArrowUp')
  await expect(prompt(page)).toHaveValue('look')
})

test('Down comes back, and past the newest clears the line', async ({ page }) => {
  await type(page, 'look')
  await type(page, 'who')

  await prompt(page).press('ArrowUp')
  await prompt(page).press('ArrowUp')
  await expect(prompt(page)).toHaveValue('look')

  await prompt(page).press('ArrowDown')
  await expect(prompt(page)).toHaveValue('who')

  await prompt(page).press('ArrowDown')
  await expect(prompt(page)).toHaveValue('')
})

test('a command that failed is still in history to be edited', async ({ page }) => {
  await type(page, 'go nowhere-at-all')
  await expect(scrollback(page)).toContainText('there’s no room called')

  await prompt(page).press('ArrowUp')
  await expect(prompt(page)).toHaveValue('go nowhere-at-all')
})

test('Tab completes a verb and leaves the cursor waiting', async ({ page }) => {
  await prompt(page).fill('wh')
  await prompt(page).press('Tab')
  await expect(prompt(page)).toHaveValue('who')

  // A verb that takes an argument leaves the cursor after a space.
  await prompt(page).fill('sa')
  await prompt(page).press('Tab')
  await expect(prompt(page)).toHaveValue('say ')
})

test('an ambiguous prefix completes to nothing rather than guessing', async ({ page }) => {
  // In commons both `look` and `leave` start with l.
  await prompt(page).fill('l')
  await prompt(page).press('Tab')
  await expect(prompt(page)).toHaveValue('l')
})

test('Tab does not throw focus out of the prompt', async ({ page }) => {
  await prompt(page).fill('wh')
  await prompt(page).press('Tab')
  await expect(prompt(page)).toBeFocused()
})

test('Ctrl-C clears the line', async ({ page }) => {
  await prompt(page).fill('something i thought better of')
  await prompt(page).press('Control+c')
  await expect(prompt(page)).toHaveValue('')
})

test('tapping the output keeps you typing', async ({ page }) => {
  await prompt(page).fill('half a thought')
  await scrollback(page).click({ position: { x: 10, y: 10 } })
  await expect(prompt(page)).toBeFocused()
  // And what you were writing survives the tap.
  await expect(prompt(page)).toHaveValue('half a thought')
})

test('the scrollback does not grow without bound', async ({ page }) => {
  // `look` in a room emits a lot of lines; twenty of them used to be kept
  // forever, along with every one before them.
  await type(page, 'leave')
  await type(page, 'go music')
  for (let i = 0; i < 20; i++) {
    await prompt(page).fill('look')
    await prompt(page).press('Enter')
  }

  const count = await scrollback(page).locator('p').count()
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThanOrEqual(600)

  // Trimming must not scramble which line is which — the reason keys had to
  // stop being array indices in the same change.
  await expect(scrollback(page)).toContainText('records in the garage')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
