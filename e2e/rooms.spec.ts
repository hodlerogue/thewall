import { expect, test, type Page } from '@playwright/test'

/**
 * §4.2, reopened, walked on a phone.
 *
 * The doc closes room creation because "40 rooms with three people each kills
 * the entire feeling". Creation is open now, so what has to be true is the
 * thing that warning was actually about: the lobby.
 */

const prompt = (page: Page) => page.getByTestId('prompt-input')
const scrollback = (page: Page) => page.getByTestId('scrollback')
const label = (page: Page) => page.getByTestId('prompt-label')

async function type(page: Page, text: string) {
  await prompt(page).fill(text)
  await prompt(page).press('Enter')
}

async function withName(page: Page) {
  await page.goto('/music')
  await type(page, 'say something to make an account with')
  await type(page, 'roommaker')
  await type(page, 'roommaker@example.com')
  await expect(label(page)).toHaveText('roommaker:music$')
}

test('make walks you into the room it just made, and the url follows', async ({ page }) => {
  await withName(page)

  await type(page, 'make garden what you are growing')
  await expect(scrollback(page)).toContainText('garden is open')
  await expect(label(page)).toHaveText('roommaker:garden$')
  await expect(page).toHaveURL(/\/garden$/)

  // §5 — an empty room is worse than no room, so it says what to do about it.
  await expect(scrollback(page)).toContainText('nothing here yet')

  // And it is a real room: you can say something in it like any other.
  await type(page, 'say four tomato plants and a lot of optimism')
  await expect(scrollback(page)).toContainText('said')
})

test('a new room is in the lobby, under the curated ones', async ({ page }) => {
  await withName(page)
  await type(page, 'make garden what you are growing')

  await type(page, 'leave')
  const lines = await scrollback(page).innerText()
  expect(lines).toContain('garden')
  // The furniture is still the furniture, and still first.
  expect(lines.indexOf('commons')).toBeLessThan(lines.lastIndexOf('garden'))
})

test('make teaches the missing half rather than reporting a failure (§3.7)', async ({ page }) => {
  await withName(page)
  await type(page, 'make garden')
  await expect(scrollback(page)).toContainText('make garden what you are growing')
})

test('a room name already taken points at the room that has it', async ({ page }) => {
  await withName(page)
  await type(page, 'make music more music')
  await expect(scrollback(page)).toContainText('already exists')
  await expect(scrollback(page)).toContainText('go music')
})

test('making a room is not something a guest is asked to sign up for', async ({ page }) => {
  await page.goto('/lobby')
  await type(page, 'make garden what you are growing')
  await expect(scrollback(page)).toContainText('you need a name first')
  // §3.9 asks at the moment of contribution, when there is a held sentence to
  // hand back. There is none here, so the ask would arrive empty.
  await expect(scrollback(page)).not.toContainText('what do you want to be called')
})

test('make is in help from everywhere, and explains itself', async ({ page }) => {
  for (const path of ['/lobby', '/music', '/commons']) {
    await page.goto(path)
    await type(page, 'help')
    await expect(scrollback(page), path).toContainText('make — start a new room')
  }

  await type(page, 'what make')
  await expect(scrollback(page)).toContainText('three a week')
})

test('find --rooms searches names and what rooms are for', async ({ page }) => {
  await page.goto('/lobby')

  await type(page, 'find --rooms kitchen')
  await expect(scrollback(page)).toContainText('what you cooked')

  // The half people forget they need: you remember what it was for.
  await type(page, 'find --rooms listening')
  await expect(scrollback(page)).toContainText('music')
  await expect(scrollback(page)).toContainText('go music to walk in')
})

test('a word that is a room name, not something said, points at the room', async ({ page }) => {
  await page.goto('/lobby')
  await type(page, 'find latenight')
  await expect(scrollback(page)).toContainText('nothing said about latenight')
  await expect(scrollback(page)).toContainText('quiet hours only')
})

test('--room still filters posts, which --rooms must not have taken over', async ({ page }) => {
  await page.goto('/lobby')
  await type(page, 'find --room=music records')
  await expect(scrollback(page)).toContainText('music/12')
})
