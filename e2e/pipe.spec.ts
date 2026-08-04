import { expect, test, type Page } from '@playwright/test'

/**
 * §4.8 in the actual interface.
 *
 * "If it never ships, this is a themed UI. If it ships, it justifies the
 * premise entirely." The pipe is real, it is hidden, and it is only ever
 * documented by `what posts`.
 */

const prompt = (page: Page) => page.getByTestId('prompt-input')
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
  await type(page, 'find --room=music --since=7d | count')
  await expect(scrollback(page)).toContainText('2 posts')
})

test('piping into go moves you, and the url follows (§3.4)', async ({ page }) => {
  await type(page, 'find --room=poker | go')
  await expect(page.getByTestId('prompt-label')).toHaveText('guest:poker/4$')
  await expect(page).toHaveURL(/\/poker\/4$/)
})

test('the doc’s own --tag example is answered with what to use instead', async ({ page }) => {
  await type(page, 'find --tag=poker --since=7d | star')
  await expect(scrollback(page)).toContainText('there are no tags — rooms do that job')
})

test('help lists the search but never the pipe', async ({ page }) => {
  await type(page, 'help')
  const help = await scrollback(page).innerText()

  // A search nobody can discover is barely a search.
  expect(help).toContain('find — ')
  // The pipe is still the part §4.8 asked to keep quiet.
  expect(help).not.toContain('|')
  expect(help).not.toContain('--room')

  await type(page, 'what find')
  await expect(scrollback(page)).toContainText('find — find something that was said')
  await expect(scrollback(page)).toContainText('| count')
})

test('searching for a word works from the prompt', async ({ page }) => {
  await type(page, 'find tomatoes')
  await expect(scrollback(page)).toContainText('kitchen/')
  await expect(scrollback(page)).toContainText('tomatoes')
})

test('a sentence containing a pipe stays a sentence (§3.3)', async ({ page }) => {
  await type(page, 'go music')
  await type(page, 'say the chord was a|b|c and it worked')

  // It reached the signup question, meaning it was taken as one sentence
  // rather than chopped into a pipeline.
  await expect(scrollback(page)).toContainText('what do you want to be called?')
  await type(page, 'cancel')
})
