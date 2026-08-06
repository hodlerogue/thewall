import { expect, test, type Page } from '@playwright/test'

/**
 * Two things a fixture test cannot see.
 *
 * The reading order is only wrong *in a browser*: the scrollback snaps to the
 * bottom after every command, so the order matters because of where the viewport
 * lands, and a unit test that reads an array of lines has no viewport. Nothing
 * in the suite could tell that `go music` filled a 380×740 screen with the
 * oldest post in the room while the newest sat above the fold.
 *
 * And `login` is the only door for somebody arriving with no session, which is
 * exactly what a fresh browser context is.
 */

const prompt = (page: Page) => page.getByTestId('prompt-input')
const scrollback = (page: Page) => page.getByTestId('scrollback')

async function type(page: Page, text: string) {
  await prompt(page).fill(text)
  await prompt(page).press('Enter')
}

test.describe('the newest thing is the one you can see', () => {
  test('a room lands on its newest post, not its oldest', async ({ page }) => {
    await page.goto('/music')
    await type(page, 'look')

    /*
     * §5's music fixture: post 11 is six hours old, post 12 is two. Newest-first
     * printing put 12 at the top of the block and 11 at the bottom, so the snap
     * to the bottom showed the older one and scrolled the newer away.
     *
     * `.last()` on both, because arriving at /music prints the room and `look`
     * prints it again — so each body is on screen twice, and the pair that
     * matters is the most recent block, the one the view is sitting on.
     */
    const oldest = scrollback(page).getByText('the bass player at the bar', { exact: false }).last()
    const newest = scrollback(page).getByText('found my dad’s records', { exact: false }).last()

    const oldestBox = await oldest.boundingBox()
    const newestBox = await newest.boundingBox()
    expect(oldestBox).not.toBeNull()
    expect(newestBox).not.toBeNull()
    expect(oldestBox!.y).toBeLessThan(newestBox!.y)

    // The part that is actually the bug: the newest one is on the screen.
    await expect(newest).toBeInViewport()
  })

  test('and it is the post nearest the prompt', async ({ page }) => {
    await page.goto('/music')
    await type(page, 'look')

    /*
     * Distance to the prompt, not "above the prompt" — which was the first
     * version of this and passed just as happily with the bug in place, because
     * every post is above the prompt either way. The claim being made is that
     * the newest post is the one your thumb is next to, and that is a
     * comparison between the two posts, not a fact about one of them.
     */
    const newest = scrollback(page).getByText('found my dad’s records', { exact: false }).last()
    const oldest = scrollback(page).getByText('the bass player at the bar', { exact: false }).last()

    const newestBox = await newest.boundingBox()
    const oldestBox = await oldest.boundingBox()
    const promptBox = await prompt(page).boundingBox()
    expect(newestBox).not.toBeNull()
    expect(oldestBox).not.toBeNull()
    expect(promptBox).not.toBeNull()

    const toPrompt = (y: number) => Math.abs(promptBox!.y - y)
    expect(toPrompt(newestBox!.y)).toBeLessThan(toPrompt(oldestBox!.y))
  })
})

test.describe('a browser that has never been signed in', () => {
  test('is told login exists, without having to already know', async ({ page }) => {
    await page.goto('/')
    await type(page, 'help')
    await expect(scrollback(page)).toContainText('login — get back into your account')
  })

  test('is told where the feed and somebody’s page are, which no verb spells', async ({ page }) => {
    await page.goto('/')
    await type(page, 'help')

    await expect(scrollback(page)).toContainText('go feed')
    await expect(scrollback(page)).toContainText('go ~name')
  })

  test('asks which name, and takes the answer as a name rather than a command', async ({
    page,
  }) => {
    await page.goto('/')
    await type(page, 'login')
    await expect(scrollback(page)).toContainText('what name do you go by here?')

    /*
     * `look` on purpose. It is a real command, and mid-question it has to be
     * read as an answer to the question — this is the same shape as the bug
     * that once created accounts called `look`, arriving by a new route.
     */
    await type(page, 'look')
    await expect(scrollback(page)).toContainText('no one here is called look')
    await expect(scrollback(page)).not.toContainText('quiet in here')
  })

  test('says nobody is called that, rather than pretending it sent something', async ({ page }) => {
    await page.goto('/')
    await type(page, 'login nobodyatall')
    await expect(scrollback(page)).toContainText('no one here is called nobodyatall')
  })

  test('offers login when the name given at signup is already taken', async ({ page }) => {
    /*
     * The loop this whole feature exists to break. A returning person says
     * something, is asked for a name, gives their own — and used to be told it
     * was taken and offered `marisol2`.
     */
    await page.goto('/commons')
    await type(page, 'say hello again')
    await type(page, 'marisol')

    await expect(scrollback(page)).toContainText('marisol is taken')
    await expect(scrollback(page)).toContainText('login marisol')
  })
})

test.describe('reading a room to the end', () => {
  test('older is offered where somebody stuck at the top of a room would look', async ({
    page,
  }) => {
    await page.goto('/music')
    await type(page, 'help')
    await expect(scrollback(page)).toContainText('older — the page before this one')
  })

  test('a room that fits says so rather than paging into nothing', async ({ page }) => {
    /*
     * The fixture rooms are small on purpose — the demo lobby is not the place
     * for a 500-post room — so what this proves is the wiring and the honest
     * answer at the boundary. The paging itself is walked end to end against a
     * 250-post room in lib/commands/older.test.ts.
     */
    await page.goto('/music')
    await type(page, 'older')
    await expect(scrollback(page)).toContainText('nothing before it')
  })

  test('a small room is not told there is more to see', async ({ page }) => {
    await page.goto('/music')
    await type(page, 'look')
    await expect(scrollback(page)).not.toContainText('older — the page before')
  })

  test('older from the lobby names somewhere it would work', async ({ page }) => {
    // `/` lands in commons, not the lobby — the demo drops you somewhere with
    // people in it. The lobby is its own path.
    await page.goto('/lobby')
    await type(page, 'older')
    await expect(scrollback(page)).toContainText('nothing to walk back through')
  })
})
