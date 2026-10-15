import { expect, test, type Page } from '@playwright/test'

/**
 * §3.4 — "thewall.sh/music/12 is the same address as the prompt. Shareable URLs
 * fall out of the design at zero cost." (The doc's words; the domain is now
 * thewall.social, and the property is what matters.)
 *
 * That only holds if it works in both directions: a URL has to put you where
 * the prompt would have, and moving in the prompt has to update the URL.
 */

const prompt = (page: Page) => page.getByTestId('prompt-input')
const scrollback = (page: Page) => page.getByTestId('scrollback')
const label = (page: Page) => page.getByTestId('prompt-label')

async function type(page: Page, text: string) {
  await prompt(page).fill(text)
  await prompt(page).press('Enter')
}

/*
 * The bare domain shows a stranger the marketing page, and anybody with an
 * account the prompt. Asked for as "the primary marketing page before you've
 * logged in" — until then `/` put everybody in commons and nothing at all sent
 * anybody to /hello.
 */
test('the front door shows somebody new the marketing page', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/hello$/)
})

test('and puts somebody with an account in commons (§3.10)', async ({ page, context }) => {
  // The cookie @supabase/ssr writes for a session. Only its presence is read at
  // the door, so any value will do here.
  await context.addCookies([{ name: 'sb-test-auth-token', value: 'x', url: 'http://127.0.0.1:3000' }])
  await page.goto('/')
  await expect(label(page)).toHaveText('guest:commons$')
  await expect(page).toHaveURL(/\/commons$/)
})

test('and a sign-in result reaches the prompt even without a session', async ({ page }) => {
  // A magic link that failed leaves no session, and its outcome arrives on `/`
  // as a query string. The marketing page cannot say what went wrong; the
  // prompt can, so a query always goes in.
  await page.goto('/?signed_in=0')
  await expect(page).toHaveURL(/\/commons\?signed_in=0$/)
})

test('and the marketing page’s way in goes to the prompt, not round again', async ({ page }) => {
  await page.goto('/hello')
  await page.locator('a.landing-button').first().click()
  await expect(page).toHaveURL(/\/commons$/)
  await expect(label(page)).toHaveText('guest:commons$')
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
  for (const room of ['commons', 'music', 'builders', 'poker', 'kitchen', 'latenight']) {
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
