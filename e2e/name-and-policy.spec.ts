import { expect, test, type Page } from '@playwright/test'

/**
 * §4.6 revised, and the two documents.
 *
 * The rename tests care about one thing above the mechanics: that both
 * consequences of releasing a name immediately are stated at the moment the
 * rename happens, rather than discovered later by somebody whose old handle
 * now belongs to a stranger.
 */

const prompt = (page: Page) => page.getByTestId('prompt-input')
const scrollback = (page: Page) => page.getByTestId('scrollback')
const label = (page: Page) => page.getByTestId('prompt-label')

async function type(page: Page, text: string) {
  await prompt(page).fill(text)
  await prompt(page).press('Enter')
}

/** §3.9 — there is no account until somebody says something. */
async function signUp(page: Page, name: string) {
  await type(page, 'say hello from the hallway')
  await type(page, name)
  await type(page, `${name}@example.com`)
  await expect(label(page)).toContainText(`${name}:`)
}

test.describe('renaming', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(label(page)).toBeVisible()
  })

  test('changes the prompt, and says what it cost', async ({ page }) => {
    await signUp(page, 'newcomer')
    await type(page, 'rename betterchoice')

    await expect(label(page)).toHaveText('betterchoice:commons$')
    await expect(scrollback(page)).toContainText('you’re betterchoice now')
    // Attribution follows you, and what you dropped is anyone's.
    await expect(scrollback(page)).toContainText('everything you’ve said says betterchoice')
    await expect(scrollback(page)).toContainText('newcomer is free for anyone to take')
  })

  test('can be done again, and again', async ({ page }) => {
    await signUp(page, 'newcomer')
    await type(page, 'rename second')
    await type(page, 'rename third')
    await type(page, 'rename fourth')
    await expect(label(page)).toHaveText('fourth:commons$')
  })

  test('refuses a name somebody is using, and leaves you as you were', async ({ page }) => {
    await signUp(page, 'newcomer')
    await type(page, 'rename marisol')
    await expect(scrollback(page)).toContainText('marisol is taken')
    await expect(label(page)).toHaveText('newcomer:commons$')
  })

  test('tells a guest how to get a name instead', async ({ page }) => {
    await type(page, 'rename somebody')
    await expect(scrollback(page)).toContainText('don’t have a name yet')
    await expect(label(page)).toHaveText('guest:commons$')
  })

  test('is in help, because a permanent-feeling name is why people leave', async ({ page }) => {
    await type(page, 'help')
    await expect(scrollback(page)).toContainText('rename')

    await type(page, 'what rename')
    await expect(scrollback(page)).toContainText('as often as you like')
  })
})

test.describe('a name that changed hands', () => {
  test('says so on the profile of whoever holds it now', async ({ page }) => {
    // The mitigation that replaces §4.6's reserved-forever rule: the warning
    // goes to the reader, who is who impersonation is actually aimed at.
    await page.goto('/~dev')
    await expect(scrollback(page)).toContainText('this name was somebody else’s until')
  })

  test('and says nothing on a profile whose name never moved', async ({ page }) => {
    await page.goto('/~marisol')
    await expect(scrollback(page)).toContainText('arrived')
    await expect(scrollback(page)).not.toContainText('somebody else’s until')
  })
})

test.describe('terms and privacy', () => {
  test('are readable in the prompt, without an account', async ({ page }) => {
    await page.goto('/')
    await type(page, 'privacy')
    await expect(scrollback(page)).toContainText('reading thewall is anonymous')
    await expect(scrollback(page)).toContainText('thewall.social/privacy')

    await type(page, 'terms')
    await expect(scrollback(page)).toContainText('thewall.social/terms')
  })

  test('are named at the moment an address is asked for', async ({ page }) => {
    await page.goto('/')
    await type(page, 'say something worth keeping')
    await type(page, 'newcomer')

    // The consent moment. A link in a footer nobody scrolls to is not it.
    await expect(scrollback(page)).toContainText('where should i send your key?')
    await expect(scrollback(page)).toContainText('type privacy')
  })

  test('are whole pages too, for anyone who has not typed anything', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page.locator('h1')).toHaveText('privacy')
    await expect(page.locator('body')).toContainText('Supabase')
    await expect(page.locator('body')).toContainText('Deletion')
    await expect(page.locator('body')).toContainText('hello@thewall.social')

    await page.goto('/terms')
    await expect(page.locator('h1')).toHaveText('terms')
    await expect(page.locator('body')).toContainText('copyright')
  })

  test('scroll, and fit a phone', async ({ page }) => {
    await page.goto('/privacy')
    // `body` has overflow:hidden so the terminal can pin its prompt; the
    // document has to bring its own scrolling or it is a page you cannot read.
    const scrollable = await page
      .locator('.document')
      .evaluate((el) => el.scrollHeight > el.clientHeight)
    expect(scrollable).toBe(true)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('say plainly that the governing law is not set, until it is', async ({ page }) => {
    // The clause is about where the operator is, not where visitors are, and
    // naming somewhere plausible would put a false statement on a published
    // page. So an unset one announces itself where nobody can deploy past it.
    // When JURISDICTION is filled in, both of these flip together.
    await page.goto('/terms')
    const notice = page.locator('.document-unfinished')
    const body = page.locator('body')

    if ((await notice.count()) > 0) {
      await expect(notice).toBeVisible()
      await expect(body).toContainText('NOT SET YET')
      await page.goto('/')
      await type(page, 'terms')
      await expect(scrollback(page)).toContainText('governing law')
    } else {
      await expect(body).not.toContainText('NOT SET YET')
    }

    // Either way, a visitor's own consumer rights survive the choice.
    await page.goto('/terms')
    await expect(body).toContainText('cannot be signed away')
  })

  test('lead back to the prompt', async ({ page }) => {
    await page.goto('/terms')
    await page.getByRole('link', { name: /back to the prompt/ }).click()
    await expect(label(page)).toBeVisible()
  })
})
