import { expect, test, type Page } from '@playwright/test'

/**
 * §3.4 — "thewall.sh/music/12 is the same address as the prompt. Shareable URLs
 * fall out of the design at zero cost."
 *
 * That only holds if it works in both directions: a URL has to put you where
 * the prompt would have, and moving in the prompt has to update the URL.
 */

const prompt = (page: Page) => page.getByRole('textbox', { name: 'command' })
const scrollback = (page: Page) => page.getByTestId('scrollback')
const label = (page: Page) => page.getByTestId('prompt-label')

async function type(page: Page, text: string) {
  await prompt(page).fill(text)
  await prompt(page).press('Enter')
}

test('the front door puts you in commons (§3.10)', async ({ page }) => {
  await page.goto('/')
  await expect(label(page)).toHaveText('guest:commons$')
  await expect(page).toHaveURL(/\/commons$/)
})

test('a room url lands you in the room', async ({ page }) => {
  await page.goto('/music')
  await expect(label(page)).toHaveText('guest:music$')
  await expect(scrollback(page)).toContainText('records in the garage')
})

test('a post url lands you inside the post, replies and all', async ({ page }) => {
  await page.goto('/music/12')
  await expect(label(page)).toHaveText('guest:music/12$')
  await expect(scrollback(page)).toContainText('records in the garage')
  await expect(scrollback(page)).toContainText('warped ones still play')
})

test('the lobby has its own address and lists the rooms', async ({ page }) => {
  await page.goto('/lobby')
  await expect(label(page)).toHaveText('guest:lobby$')
  for (const room of ['commons', 'music', 'poker', 'kitchen', 'latenight']) {
    await expect(scrollback(page)).toContainText(room)
  }
})

test('moving in the prompt moves the url with it', async ({ page }) => {
  await page.goto('/lobby')

  await type(page, 'go music')
  await expect(page).toHaveURL(/\/music$/)

  await type(page, 'go 12')
  await expect(page).toHaveURL(/\/music\/12$/)

  await type(page, 'leave')
  await expect(page).toHaveURL(/\/music$/)

  await type(page, 'leave')
  await expect(page).toHaveURL(/\/lobby$/)
})

test('reload holds your position', async ({ page }) => {
  await page.goto('/lobby')
  await type(page, 'go poker')
  await type(page, 'go 4')
  await expect(page).toHaveURL(/\/poker\/4$/)

  await page.reload()
  await expect(label(page)).toHaveText('guest:poker/4$')
  await expect(scrollback(page)).toContainText('flopped a set')
})

test('back and forward move you the way go and leave do', async ({ page }) => {
  await page.goto('/lobby')
  await type(page, 'go music')
  await type(page, 'go 12')

  await page.goBack()
  await expect(page).toHaveURL(/\/music$/)
  await expect(label(page)).toHaveText('guest:music$')

  await page.goForward()
  await expect(page).toHaveURL(/\/music\/12$/)
  await expect(label(page)).toHaveText('guest:music/12$')
})

test('a url that points at nothing says so and leaves you somewhere real', async ({ page }) => {
  await page.goto('/nowhere')
  await expect(scrollback(page)).toContainText('there’s no room called nowhere')
  await expect(label(page)).toHaveText('guest:lobby$')

  await page.goto('/music/999')
  await expect(scrollback(page)).toContainText('there’s no post 999 in music')
  await expect(label(page)).toHaveText('guest:music$')
})

test('the url a post shows is the one you can type back in', async ({ page }) => {
  await page.goto('/lobby')
  await type(page, 'go music')
  await type(page, 'go 11')

  const url = page.url()
  await page.goto(url)
  await expect(label(page)).toHaveText('guest:music/11$')
  await expect(scrollback(page)).toContainText('bass player')
})
