import { expect, test, type Page } from '@playwright/test'

/**
 * §3.9 walked end to end on a phone, against fixtures.
 *
 * The claim being tested is the one the whole design rests on: someone reads
 * anonymously, types a sentence, is asked for a name and an email in the prompt
 * itself, and the sentence they already typed goes through without them
 * touching it again.
 */

const prompt = (page: Page) => page.getByRole('textbox', { name: 'command' })
const scrollback = (page: Page) => page.getByTestId('scrollback')

async function type(page: Page, text: string) {
  await prompt(page).fill(text)
  await prompt(page).press('Enter')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('prompt-label')).toBeVisible()
})

test('reading never asks who you are', async ({ page }) => {
  await type(page, 'leave')
  await type(page, 'go music')
  await type(page, 'go 12')
  await type(page, 'look')

  await expect(page.getByTestId('prompt-label')).toHaveText('guest:music/12$')
  await expect(scrollback(page)).not.toContainText('what do you want to be called')
})

test('the first say collects a name and an email, then sends what you typed', async ({ page }) => {
  await type(page, 'leave')
  await type(page, 'go music')

  const sentence = 'found my dads records in the garage'
  await type(page, `say ${sentence}`)
  await expect(scrollback(page)).toContainText('what do you want to be called?')

  // A taken name is refused with alternates, not just a refusal.
  await type(page, 'jameson')
  await expect(scrollback(page)).toContainText('jameson is taken')
  await expect(scrollback(page)).toContainText('are free')

  await type(page, 'newcomer')
  await expect(scrollback(page)).toContainText('where should i send your key?')
  await expect(scrollback(page)).toContainText('no password')

  await type(page, 'newcomer@example.com')

  // The sentence posts itself. The user never retyped it.
  await expect(scrollback(page)).toContainText('now — the thing you were trying to say')
  await expect(scrollback(page)).toContainText('said — it’s post')

  // And the prompt stops calling them a guest.
  await expect(page.getByTestId('prompt-label')).toHaveText('newcomer:music$')
})

test('cancel returns to reading with nothing sent', async ({ page }) => {
  await type(page, 'leave')
  await type(page, 'go poker')
  await type(page, 'say something i thought better of')
  await expect(scrollback(page)).toContainText('what do you want to be called?')

  await type(page, 'cancel')
  await expect(scrollback(page)).toContainText('nothing sent')
  await expect(page.getByTestId('prompt-label')).toHaveText('guest:poker$')

  // Still a shell, and still anonymous.
  await type(page, 'look')
  await expect(scrollback(page)).toContainText('flopped a set')
})

test('the signup questions are usable with the keyboard open', async ({ page }) => {
  await type(page, 'say hello from the hallway')
  await expect(scrollback(page)).toContainText('what do you want to be called?')

  // Shrink the visual viewport the way a software keyboard does.
  await page.evaluate(() => {
    const vv = window.visualViewport!
    Object.defineProperty(vv, 'height', { value: 380, configurable: true })
    vv.dispatchEvent(new Event('resize'))
  })

  const box = (await prompt(page).boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(380)

  // The question is still readable above the prompt, not scrolled off.
  await expect(scrollback(page)).toContainText('what do you want to be called?')
})
