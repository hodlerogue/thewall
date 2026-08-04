import { expect, test, type Page } from '@playwright/test'

/**
 * §3.10 — somebody, as a view rather than a place.
 *
 * `thewall.social/~marisol` is the same value as the prompt path (§3.4), so
 * both directions have to work, and the property that matters most is the
 * negative one: there is no way to contribute to a profile, from the palette
 * or from the prompt.
 */

const prompt = (page: Page) => page.getByTestId('prompt-input')
const scrollback = (page: Page) => page.getByTestId('scrollback')
const label = (page: Page) => page.getByTestId('prompt-label')

async function type(page: Page, text: string) {
  await prompt(page).fill(text)
  await prompt(page).press('Enter')
}

test('go ~marisol works from a room, the lobby, and inside a post', async ({ page }) => {
  await page.goto('/music')
  await type(page, 'go ~marisol')
  await expect(label(page)).toHaveText('guest:~marisol$')
  await expect(page).toHaveURL(/\/~marisol$/)

  await page.goto('/lobby')
  await type(page, 'go ~marisol')
  await expect(label(page)).toHaveText('guest:~marisol$')

  await page.goto('/music/12')
  await type(page, 'go ~marisol')
  await expect(label(page)).toHaveText('guest:~marisol$')
})

test('the url is the prompt path, and it holds through a reload', async ({ page }) => {
  await page.goto('/~marisol')
  await expect(label(page)).toHaveText('guest:~marisol$')
  await expect(scrollback(page)).toContainText('arrived')

  await page.reload()
  await expect(label(page)).toHaveText('guest:~marisol$')
})

test('a profile is a set of doors, each one an address in a room', async ({ page }) => {
  await page.goto('/~jameson')

  // The addresses shown are the ones you can type back in — the same claim
  // §3.4 makes about the URL, applied to a listing that crosses rooms.
  await expect(scrollback(page)).toContainText('music/12')
  await expect(scrollback(page)).toContainText('poker/2')

  await type(page, 'go music')
  await type(page, 'go 12')
  await expect(label(page)).toHaveText('guest:music/12$')
  await expect(scrollback(page)).toContainText('records in the garage')
})

test('nothing on a profile is postable', async ({ page }) => {
  await page.goto('/~marisol')

  // Not in the palette — where most people learn what a place is for.
  await expect(page.locator('.chip')).not.toHaveCount(0)
  await expect(page.locator('.chip[data-verb="say"]')).toHaveCount(0)

  // And refused in the prompt by naming the fix, not by silently doing
  // nothing and not with an error code (§3.7).
  await type(page, 'say hello there')
  await expect(scrollback(page)).toContainText('you have to be in a room first')
  await expect(scrollback(page)).toContainText('try: go ')
  await expect(label(page)).toHaveText('guest:~marisol$')

  // No signup was triggered either: refusing to post is not the same as
  // asking who you are.
  await expect(scrollback(page)).not.toContainText('what do you want to be called')
})

test('a name that is not there says so the way a missing room does', async ({ page }) => {
  await page.goto('/music')
  await type(page, 'go ~nobodyatall')
  await expect(scrollback(page)).toContainText('there’s no one called nobodyatall')
  // And leaves you somewhere real.
  await expect(label(page)).toHaveText('guest:music$')

  await page.goto('/~nobodyatall')
  await expect(scrollback(page)).toContainText('there’s no one called nobodyatall')
  await expect(label(page)).toHaveText('guest:lobby$')
})

test('leave backs out of a profile to the lobby', async ({ page }) => {
  await page.goto('/~marisol')
  await type(page, 'leave')
  await expect(label(page)).toHaveText('guest:lobby$')
  await expect(page).toHaveURL(/\/lobby$/)
})

test('standing on somebody is itself a search filter', async ({ page }) => {
  await page.goto('/~marisol')
  await type(page, 'find tomatoes')
  await expect(scrollback(page)).toContainText('kitchen/8')

  // jameson said the thing about records, not marisol.
  await type(page, 'find records')
  await expect(scrollback(page)).toContainText('nothing said about records')
})
