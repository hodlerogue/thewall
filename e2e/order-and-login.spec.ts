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
const label = (page: Page) => page.getByTestId('prompt-label')

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

test.describe('the instruction printed mid-signup can be typed', () => {
  test('login <name> at the name question is a command, not a name', async ({ page }) => {
    await page.goto('/commons')
    await type(page, 'say hello again')
    await type(page, 'marisol')
    await expect(scrollback(page)).toContainText('login marisol')

    // The exact thing the screen just told them to type.
    await type(page, 'login marisol')
    await expect(scrollback(page)).not.toContainText('login_marisol')
    await expect(scrollback(page)).not.toContainText('letters, numbers and underscores')

    // And they are out of the signup, not still being asked for a name.
    await type(page, 'look')
    await expect(scrollback(page)).toContainText('commons keeps nothing')
  })
})

test.describe('a contribution says where it went', () => {
  test('a reply answers with the address of the post it is under', async ({ page }) => {
    await page.goto('/music/12')
    await type(page, 'say warped ones are the best ones')
    await type(page, 'replier')
    await type(page, 'replier@example.com')
    await expect(scrollback(page)).toContainText('music/12')
  })

  test('and the line is accent, not the colour used for things you skim past', async ({ page }) => {
    await page.goto('/music')
    await type(page, 'say found a second turntable')
    await type(page, 'toner')
    await type(page, 'toner@example.com')

    const line = scrollback(page).locator('p', { hasText: /^music\/\d+$/ }).last()
    await expect(line).toHaveClass(/line-accent/)
  })
})

test.describe('the daily email is a thing you switch off', () => {
  test('is on for a brand new account, and says they did not do it', async ({ page }) => {
    /*
     * The default flipped: an opt-in only ever reached people already coming
     * back, which is the one group that needs no reminding. What has to be true
     * of an opt-out is that somebody finds out — so this walks a fresh signup
     * and asks, exactly as a person would.
     */
    await page.goto('/commons')
    await type(page, 'say hello there')
    await type(page, 'notifier')
    await type(page, 'notifier@example.com')

    // Told at the moment the address changes hands, which is the only moment
    // this is a default rather than a trick.
    await expect(scrollback(page)).toContainText('i’ll email you when somebody answers you')

    await type(page, 'notify')
    await expect(scrollback(page)).toContainText('where everyone starts')
    await expect(scrollback(page)).toContainText('notify off')
  })

  test('and one word ends it', async ({ page }) => {
    await page.goto('/commons')
    await type(page, 'say hello there')
    await type(page, 'quitter')
    await type(page, 'quitter@example.com')

    await type(page, 'notify off')
    await type(page, 'notify')
    await expect(scrollback(page)).toContainText('off. nothing is emailed to you')
  })

  test('turning it on names the bound and the way out together', async ({ page }) => {
    await page.goto('/commons')
    await type(page, 'say hello there')
    await type(page, 'switcher')
    await type(page, 'switcher@example.com')

    await type(page, 'notify on')
    await expect(scrollback(page)).toContainText('one email a day')
    await expect(scrollback(page)).toContainText('only when somebody has answered you')
    await expect(scrollback(page)).toContainText('notify off')
  })

  test('is findable in help, since a setting nobody can see is not a choice', async ({ page }) => {
    await page.goto('/lobby')
    await type(page, 'help')
    // Glossed for the way out, not the way in. It is on, so somebody scanning
    // this list is far likelier to be looking for how to stop it, and a gloss
    // that reads as an offer hides that from them.
    await expect(scrollback(page)).toContainText('notify — the daily email, and how to stop it')
  })

  test('a guest is told there is nowhere to send anything', async ({ page }) => {
    await page.goto('/lobby')
    await type(page, 'notify on')
    await expect(scrollback(page)).toContainText('reading as a guest')
  })
})

test.describe('the unsubscribe link in the email', () => {
  test('answers a one-click POST, which is what RFC 8058 clients send', async ({ request }) => {
    /*
     * The `List-Unsubscribe-Post` header tells a mail client it may POST to the
     * unsubscribe URL, and that URL is a page rather than a route handler. It
     * works because Next renders a dynamic page for any method — a property of
     * the framework rather than something the code asks for, which is exactly
     * the kind of thing that changes under you in a minor version.
     */
    const response = await request.post('/unsubscribe?t=00000000-0000-4000-8000-000000000000')
    expect(response.status()).toBe(200)
  })

  test('a GET works too, for the link in the body of the message', async ({ page }) => {
    await page.goto('/unsubscribe?t=00000000-0000-4000-8000-000000000000')
    // Fixtures have no database, so the honest answer is "that link doesn't
    // match anything" — and it is still a page rather than a crash.
    await expect(page.locator('main')).toContainText('thewall.social')
  })

  test('says how to stop it without this page, in case this page is the thing broken', async ({
    page,
  }) => {
    await page.goto('/unsubscribe?t=00000000-0000-4000-8000-000000000000')
    await expect(page.locator('main')).toContainText('notify off')
  })
})

test.describe('leaving a device', () => {
  test('logout drops you back to guest, and the prompt says so', async ({ page }) => {
    await page.goto('/commons')
    await type(page, 'say hello there')
    await type(page, 'leaver')
    await type(page, 'leaver@example.com')
    await expect(page.getByTestId('prompt-label')).toHaveText('leaver:commons$')

    await type(page, 'logout')
    // The prompt is the thing that says who you are. If it still said `leaver`
    // after this, the message would be the only evidence and it would be wrong.
    await expect(page.getByTestId('prompt-label')).toHaveText('guest:commons$')
    await expect(scrollback(page)).toContainText('isn’t leaver anymore')
  })

  test('says the posts stay and names the way back', async ({ page }) => {
    await page.goto('/commons')
    await type(page, 'say hello there')
    await type(page, 'stayer')
    await type(page, 'stayer@example.com')
    await type(page, 'logout')

    await expect(scrollback(page)).toContainText('still there')
    await expect(scrollback(page)).toContainText('login stayer')
  })

  test('is in help, where somebody at a borrowed machine would look', async ({ page }) => {
    await page.goto('/lobby')
    await type(page, 'help')
    await expect(scrollback(page)).toContainText('logout — leave this device')
  })
})

test('signing in with the code, which is the whole point of it', async ({ page }) => {
  /*
   * "When i click the link in my gmail and then select safari its still opening
   * it in the gmail app." Not a browser-picker problem: a mail app opens links
   * in a browser it owns, so the key is spent there, and the browser you were
   * reading in never gets a session.
   *
   * This walk is the fix, on the phone the whole design is aimed at — ask,
   * type, and be signed in *here*, with no browser handed off to anybody.
   */
  await page.goto('/music')
  await type(page, 'login marisol')

  // The demo build says out loud that it emails nothing and hands over the
  // code, so the flow is walkable here rather than only on the real site.
  await expect(scrollback(page)).toContainText('this is a demo')
  await expect(scrollback(page)).toContainText('type the short code')
  await expect(scrollback(page)).toContainText('this browser')

  // Wrong first, because that is the common case on six characters by thumb —
  // and coming back to the same question is what makes it survivable.
  await type(page, '999999')
  await expect(scrollback(page)).toContainText('didn’t work')
  await expect(label(page)).toHaveText('guest:music$')

  // Spaces are tolerated: a code read off a screen gets typed with them about
  // as often as without, and refusing that is refusing somebody who was right.
  await type(page, '123 456')
  await expect(scrollback(page)).toContainText('you’re marisol again')
  await expect(label(page)).toHaveText('marisol:music$')
})

test('the code question can be walked away from', async ({ page }) => {
  await page.goto('/music')
  await type(page, 'login marisol')
  await type(page, 'cancel')

  await expect(label(page)).toHaveText('guest:music$')
  // A key really is sitting in a real inbox at this point, so the cancel line
  // must not say nothing was sent.
  await expect(scrollback(page)).not.toContainText('nothing sent')

  // And reading carries on as normal, which is the promise cancel makes.
  await type(page, 'leave')
  await expect(scrollback(page)).toContainText('commons')
  await expect(label(page)).toHaveText('guest:lobby$')
})
