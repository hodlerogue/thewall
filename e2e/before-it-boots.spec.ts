import { expect, test } from '@playwright/test'

/**
 * The room, in the second before the prompt arrives.
 *
 * Everything here is fetched in the browser, so the server sends the room as a
 * page and the shell replaces it once it has booted. That is deliberate — it is
 * what a crawler reads, what somebody with JavaScript off keeps, and what
 * stopped the first paint being a spinner — but it was written as its own thing
 * and looked like one.
 *
 * Reported as: "im experiencing this issue when the commons page first loads,
 * it flashes this in the top left for a brief moment and then loads the page",
 * with a screenshot of a post whose body appeared twice.
 *
 * So these are the properties that make the swap read as the prompt arriving
 * under a room you were already looking at, rather than as one page replacing
 * another. They run with JavaScript switched off, which is the only way to hold
 * the pre-boot page still long enough to assert anything about it.
 */

test.describe('with no JavaScript at all', () => {
  test.use({ javaScriptEnabled: false })

  test('says everything once', async ({ page }) => {
    /*
     * The defect in the screenshot. The heading was an 80-character excerpt of
     * the body and the paragraph under it was the whole body, so any post
     * shorter than that printed twice — which in commons is most of them, and
     * is duplicate content to a crawler for the same reason.
     */
    await page.goto('/commons')
    const body = await page.locator('.readable').innerText()

    const said = 'four pounds of tomatoes from one plant'
    expect(body.split(said).length - 1, `"${said}" appears more than once`).toBe(1)
  })

  test('runs oldest first, the way the room does', async ({ page }) => {
    // The scrollback lands on its end, so a room prints oldest-first and the
    // newest thing sits by the prompt. Printing this page the other way made
    // the order visibly flip as the shell booted.
    await page.goto('/music')
    const text = await page.locator('.readable').innerText()
    expect(text.indexOf('the bass player')).toBeLessThan(text.indexOf('found my dad’s records'))
  })

  test('offers a door for every post in a room that has addresses', async ({ page }) => {
    await page.goto('/music')
    await expect(page.getByRole('link', { name: '12' })).toHaveAttribute('href', '/music/12')
  })

  test('offers none in commons, which has no addresses at all', async ({ page }) => {
    /*
     * §3.10 — nothing in commons has a permanent number, and `go 26` there
     * answers that there is nothing to open. Every post was a link anyway, so
     * the flash was handing out doors that do not exist.
     */
    await page.goto('/commons')
    const links = await page.locator('.readable a').all()
    for (const link of links) {
      expect(await link.getAttribute('href')).not.toMatch(/^\/commons\//)
    }
    // And there is still a way out of it, which is the point of the page.
    await expect(page.getByRole('link', { name: 'every room' })).toBeVisible()
  })

  test('is visible, not clipped away for robots to find', async ({ page }) => {
    // The line between progressive enhancement and cloaking: whatever a crawler
    // reads, a person reads.
    await page.goto('/music')
    const box = await page.locator('.readable').boundingBox()
    expect(box!.height).toBeGreaterThan(40)
  })
})

test('shows the same room the shell then shows, in the same order', async ({ page, context }) => {
  /*
   * The whole of it, as one assertion. Both pages are built from the same room
   * by different renderers — this one is markup with links in it, the other is
   * a scrollback — so they cannot share code the way the demo and the terminal
   * do. What they can share is the answer.
   */
  const bodies = ['the bass player', 'found my dad’s records']

  const quiet = await context.browser()!.newContext({ javaScriptEnabled: false })
  const flat = await quiet.newPage()
  await flat.goto(`${test.info().project.use.baseURL ?? 'http://localhost:3000'}/music`)
  const before = await flat.locator('.readable').innerText()
  await quiet.close()

  await page.goto('/music')
  await page.waitForSelector('[data-testid=prompt-input]')
  const after = await page.getByTestId('scrollback').innerText()

  for (const body of bodies) {
    expect(before, `pre-boot is missing ${body}`).toContain(body)
    expect(after, `booted is missing ${body}`).toContain(body)
  }
  // Same order in both, which is what stops the flash reshuffling.
  expect(before.indexOf(bodies[0])).toBeLessThan(before.indexOf(bodies[1]))
  expect(after.indexOf(bodies[0])).toBeLessThan(after.indexOf(bodies[1]))
})
