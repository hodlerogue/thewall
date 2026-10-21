import { expect, test } from '@playwright/test'

/**
 * /admin, as the demo build serves it.
 *
 * The demo has no database, so the dashboard says so rather than pretending.
 * Its data side — who may see it, what restore and hide do — is tested where it
 * lives, in schema.test.sql, against the functions the page calls.
 */

test('the dashboard is a page of its own, and says the demo has nothing to review', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.locator('h1')).toHaveText('thewall · admin')
  await expect(page.locator('main')).toContainText('This is the demo build')
})

test('it is kept out of search results', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  const robots = await (await page.request.get('/robots.txt')).text()
  expect(robots).toContain('Disallow: /admin')
})

test('it leads back to the prompt', async ({ page }) => {
  await page.goto('/admin')
  await page.getByRole('link', { name: /back to the prompt/ }).click()
  await expect(page).toHaveURL(/\/commons$/)
})

test('it fits a phone', async ({ page }) => {
  await page.goto('/admin')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
