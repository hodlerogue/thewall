import { expect, test, type Page } from '@playwright/test'

/**
 * Somebody — their page, and their wall.
 *
 * `thewall.social/~marisol` is the same value as the prompt path (§3.4), so
 * both directions have to work. The property that matters most is now about
 * ownership rather than absence: only marisol may start something on
 * `~marisol`, anybody may answer what is there, and no wall is ever in the
 * lobby (§4.2).
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

test('somebody else’s wall is theirs to start things on', async ({ page }) => {
  await page.goto('/~marisol')

  // Not in the palette — where most people learn what a place is for. A chip
  // that always fails teaches the wrong thing.
  await expect(page.locator('.chip')).not.toHaveCount(0)
  await expect(page.locator('.chip[data-verb="say"]')).toHaveCount(0)

  // And refused in the prompt by naming what you *can* do, not with an error
  // code and not by silently doing nothing (§3.7).
  await type(page, 'say hello there')
  await expect(scrollback(page)).toContainText('only they can put things on it')
  // And the fix names a post that is really on her wall.
  await expect(scrollback(page)).toContainText("you can answer what's here: go 2")
  await expect(label(page)).toHaveText('guest:~marisol$')

  // No signup was triggered either: refusing is not the same as asking who
  // you are, and being asked here would imply a name would have helped.
  await expect(scrollback(page)).not.toContainText('what do you want to be called')
})

test('a wall post opens from the page it is on, and has its own url', async ({ page }) => {
  await page.goto('/~marisol')
  await expect(scrollback(page)).toContainText('~marisol/2')

  await type(page, 'go 2')
  await expect(label(page)).toHaveText('guest:~marisol/2$')
  await expect(page).toHaveURL(/\/~marisol\/2$/)
  await expect(scrollback(page)).toContainText('neighbours')

  // The other direction: the address is a link somebody can send.
  await page.goto('/~marisol/2')
  await expect(label(page)).toHaveText('guest:~marisol/2$')
  await expect(scrollback(page)).toContainText('neighbours')

  // And backing out lands on the person, which survives a reload — the two
  // ways of spelling "at ~marisol" would otherwise disagree after one.
  await type(page, 'leave')
  await expect(label(page)).toHaveText('guest:~marisol$')
  await expect(page).toHaveURL(/\/~marisol$/)
  await expect(page.locator('.chip[data-verb="say"]')).toHaveCount(0)
  await page.reload()
  await expect(label(page)).toHaveText('guest:~marisol$')
})

test('anybody can answer what is on a wall', async ({ page }) => {
  await page.goto('/~marisol/2')

  // Inside a wall post you are inside a post: `say` is the contribution verb
  // it always was, so this is the signup ask and not a refusal.
  await expect(page.locator('.chip[data-verb="say"]')).toHaveCount(1)
  await type(page, 'say the fan people are the good people')
  await expect(scrollback(page)).toContainText('what do you want to be called?')
})

test('walls stay out of the lobby (§4.2)', async ({ page }) => {
  await page.goto('/lobby')
  // Forty rooms with three people each is what a room per person does to a
  // room list, and the lobby is the one place that must not happen.
  await expect(scrollback(page)).not.toContainText('~')
})

test('your own wall is the one profile you can say something on', async ({ page }) => {
  await page.goto('/music')
  await type(page, 'say something to make an account with')
  await type(page, 'wallwalker')
  await type(page, 'wallwalker@example.com')
  await expect(label(page)).toHaveText('wallwalker:music$')

  await type(page, 'go ~wallwalker')
  await expect(label(page)).toHaveText('wallwalker:~wallwalker$')

  // The palette is where the difference shows: this is the same place as
  // somebody else's page, and the only one with a `say` on it.
  await expect(page.locator('.chip[data-verb="say"]')).toHaveCount(1)

  await type(page, 'say putting this on my own wall')
  await expect(scrollback(page)).not.toContainText('only they can put things on it')
  await expect(scrollback(page)).toContainText('said')
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
