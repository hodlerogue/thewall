import { expect, test, type Page } from '@playwright/test'

/**
 * §4.8 in the actual interface.
 *
 * "If it never ships, this is a themed UI. If it ships, it justifies the
 * premise entirely." The pipe is real, it is hidden, and it is only ever
 * documented by `what posts`.
 */

const prompt = (page: Page) => page.getByRole('textbox', { name: 'command' })
const scrollback = (page: Page) => page.getByTestId('scrollback')

async function type(page: Page, text: string) {
  await prompt(page).fill(text)
  await prompt(page).press('Enter')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/lobby')
  await expect(page.getByTestId('prompt-label')).toBeVisible()
})

test('a pipeline runs and returns something real', async ({ page }) => {
  await type(page, 'posts --room=music --since=7d | count')
  await expect(scrollback(page)).toContainText('2 posts')
})

test('piping into go moves you, and the url follows (§3.4)', async ({ page }) => {
  await type(page, 'posts --room=poker | go')
  await expect(page.getByTestId('prompt-label')).toHaveText('guest:poker/4$')
  await expect(page).toHaveURL(/\/poker\/4$/)
})

test('the doc’s own --tag example is answered with what to use instead', async ({ page }) => {
  await type(page, 'posts --tag=poker --since=7d | star')
  await expect(scrollback(page)).toContainText('there are no tags — rooms do that job')
})

test('help never mentions it, but what posts explains it fully', async ({ page }) => {
  await type(page, 'help')
  const help = await scrollback(page).innerText()
  expect(help).not.toContain('posts —')

  await type(page, 'what posts')
  await expect(scrollback(page)).toContainText('posts — find posts across rooms')
  await expect(scrollback(page)).toContainText('| count')
})

test('a sentence containing a pipe stays a sentence (§3.3)', async ({ page }) => {
  await type(page, 'go music')
  await type(page, 'say the chord was a|b|c and it worked')

  // It reached the signup question, meaning it was taken as one sentence
  // rather than chopped into a pipeline.
  await expect(scrollback(page)).toContainText('what do you want to be called?')
  await type(page, 'cancel')
})
