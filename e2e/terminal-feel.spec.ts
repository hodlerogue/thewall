import { expect, test, type Page } from '@playwright/test'

/**
 * The reflexes anyone who has used a terminal arrives with (§4.5).
 *
 * None of these existed — there was no onKeyDown in the codebase at all — and
 * they are the cheapest available purchase of "this is a real interface"
 * rather than a text box wearing one.
 */

const prompt = (page: Page) => page.getByTestId('prompt-input')
const scrollback = (page: Page) => page.getByTestId('scrollback')

async function type(page: Page, text: string) {
  await prompt(page).fill(text)
  await prompt(page).press('Enter')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('prompt-label')).toBeVisible()
})

test('Up walks back through what you typed', async ({ page }) => {
  await type(page, 'look')
  await type(page, 'who')

  await prompt(page).press('ArrowUp')
  await expect(prompt(page)).toHaveValue('who')

  await prompt(page).press('ArrowUp')
  await expect(prompt(page)).toHaveValue('look')

  // And does not walk off the end.
  await prompt(page).press('ArrowUp')
  await expect(prompt(page)).toHaveValue('look')
})

test('Down comes back, and past the newest clears the line', async ({ page }) => {
  await type(page, 'look')
  await type(page, 'who')

  await prompt(page).press('ArrowUp')
  await prompt(page).press('ArrowUp')
  await expect(prompt(page)).toHaveValue('look')

  await prompt(page).press('ArrowDown')
  await expect(prompt(page)).toHaveValue('who')

  await prompt(page).press('ArrowDown')
  await expect(prompt(page)).toHaveValue('')
})

test('a command that failed is still in history to be edited', async ({ page }) => {
  await type(page, 'go nowhere-at-all')
  await expect(scrollback(page)).toContainText('there’s no room called')

  await prompt(page).press('ArrowUp')
  await expect(prompt(page)).toHaveValue('go nowhere-at-all')
})

test('Tab completes a verb and leaves the cursor waiting', async ({ page }) => {
  await prompt(page).fill('wh')
  await prompt(page).press('Tab')
  await expect(prompt(page)).toHaveValue('who')

  // A verb that takes an argument leaves the cursor after a space.
  await prompt(page).fill('sa')
  await prompt(page).press('Tab')
  await expect(prompt(page)).toHaveValue('say ')
})

test('an ambiguous prefix completes to nothing rather than guessing', async ({ page }) => {
  // In commons both `look` and `leave` start with l.
  await prompt(page).fill('l')
  await prompt(page).press('Tab')
  await expect(prompt(page)).toHaveValue('l')
})

test('Tab does not throw focus out of the prompt', async ({ page }) => {
  await prompt(page).fill('wh')
  await prompt(page).press('Tab')
  await expect(prompt(page)).toBeFocused()
})

test('Ctrl-C clears the line', async ({ page }) => {
  await prompt(page).fill('something i thought better of')
  await prompt(page).press('Control+c')
  await expect(prompt(page)).toHaveValue('')
})

test('tapping the output keeps you typing', async ({ page }) => {
  await prompt(page).fill('half a thought')
  await scrollback(page).click({ position: { x: 10, y: 10 } })
  await expect(prompt(page)).toBeFocused()
  // And what you were writing survives the tap.
  await expect(prompt(page)).toHaveValue('half a thought')
})

test('the scrollback does not grow without bound', async ({ page }) => {
  // `look` in a room emits a lot of lines; twenty of them used to be kept
  // forever, along with every one before them.
  await type(page, 'leave')
  await type(page, 'go music')
  for (let i = 0; i < 20; i++) {
    await prompt(page).fill('look')
    await prompt(page).press('Enter')
  }

  const count = await scrollback(page).locator('p').count()
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThanOrEqual(600)

  // Trimming must not scramble which line is which — the reason keys had to
  // stop being array indices in the same change.
  await expect(scrollback(page)).toContainText('records in the garage')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('something blinks where you are meant to type', async ({ page }) => {
  // The input is transparent, borderless and empty, and a browser draws no
  // caret in a field it has not been given — so on a phone, before the first
  // tap, nothing on screen said "here".
  const caret = page.locator('.caret')
  await expect(caret).toBeVisible()

  // Exactly where the first character lands: after the label, and taking no
  // width of its own, so the text starts in the same place either way.
  const box = (await caret.boundingBox())!
  const label = (await page.getByTestId('prompt-label').boundingBox())!
  const input = (await prompt(page).boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(label.x + label.width - 1)
  expect(box.x).toBeLessThanOrEqual(input.x + 2)

  // It blinks, rather than merely sitting there.
  const animation = await caret.evaluate((el) => getComputedStyle(el).animationName)
  expect(animation).toBe('caret-blink')
})

test('the drawn cursor gets out of the way of the real one', async ({ page }) => {
  // Two cursors is one too many, and once there are words the words are the
  // signal.
  await prompt(page).focus()
  await expect(page.locator('.caret')).toHaveCount(0)

  await prompt(page).fill('go music')
  await expect(page.locator('.caret')).toHaveCount(0)

  await prompt(page).fill('')
  await prompt(page).blur()
  await expect(page.locator('.caret')).toBeVisible()
})

test('reply is in help, and says what it needs', async ({ page }) => {
  // The thing everybody wants to do second. `say` only reads as "reply" once
  // you are already inside a post, and an alias is invisible by design (§3.5),
  // so the step people were missing was never written down anywhere.
  await type(page, 'leave')
  await type(page, 'go music')
  await type(page, 'help')
  await expect(scrollback(page)).toContainText('reply')

  await type(page, 'reply nice one')
  // Named with a post that is actually there, not an invented number — and
  // carrying the sentence, so following the instruction is one edit.
  await expect(scrollback(page)).toContainText('reply 12 nice one')

  // And inside one, it is simply say.
  await type(page, 'go 12')
  await type(page, 'help')
  await expect(scrollback(page)).toContainText('answer this')
})

test('a post can be answered without opening it', async ({ page }) => {
  /*
   * "I want a command where you can reply to a post without opening it."
   *
   * Two things have to be true on the screen, and only a real browser can say
   * so: the reply says which post it landed on — the prompt cannot, because you
   * never went there — and the prompt is unchanged, because not moving is the
   * entire feature.
   */
  await page.goto('/music')
  await type(page, 'reply 12 the warped ones still play')
  await type(page, 'ryan')
  await type(page, 'ryan@example.com')

  await expect(scrollback(page)).toContainText('music/12')
  await expect(page.getByTestId('prompt-label')).toHaveText('ryan:music$')
})

test('and from another room entirely, by its whole address', async ({ page }) => {
  // The form `find` and `mail` print back at you, which is most of the reason
  // it is worth having: the thing to type is already on the screen.
  await page.goto('/poker')
  await type(page, 'reply music/12 i had that record too')
  await type(page, 'ryan')
  await type(page, 'ryan@example.com')

  await expect(scrollback(page)).toContainText('music/12')
  await expect(page.getByTestId('prompt-label')).toHaveText('ryan:poker$')
})

test('the slash spelling hands back the line with the space in it', async ({ page }) => {
  // Asked for as `reply/5`, which is the one spelling it cannot have —
  // `music/12` already means post 12 in music. So the answer is their own line,
  // corrected, ready to run.
  await page.goto('/music')
  await type(page, 'reply/12 that is the one')
  await expect(scrollback(page)).toContainText('reply 12 that is the one')
})

test('reply in a room no longer posts a brand new post', async ({ page }) => {
  // It was an alias for `say`, so this used to start a top-level post — the
  // opposite of what the word asks for, and irreversible once sent.
  await type(page, 'leave')
  await type(page, 'go music')
  await type(page, 'reply this should not become a post')

  await expect(scrollback(page)).not.toContainText('music/')
  await expect(scrollback(page)).not.toContainText('what do you want to be called')
})


test('commons never mentions a post number, because it has none to mention', async ({ page }) => {
  /*
   * From a screenshot of commons: "i'm not seeing any numbers next to these
   * posts. don't i need to type a number to open it so i can reply? but it
   * tells me the post number when i'm the one sending it."
   *
   * Both observations were correct. §3.10 gives commons no addresses, so the
   * listing rightly shows none — and the confirmation announced one anyway,
   * pointing at a door that is not there.
   */
  await page.goto('/commons')
  await type(page, 'say good to be here')
  await type(page, 'ryan')
  await type(page, 'ryan@example.com')

  /*
   * The held sentence landed, and the line that says so has to be complete on
   * its own — because in commons there is no address, so nothing follows it.
   * It used to read "now — the thing you were trying to say." with a receipt
   * underneath; once the receipt went, that was a promise followed by blank.
   */
  await expect(scrollback(page)).toContainText('the thing you were trying to say is up')
  await expect(scrollback(page)).not.toContainText('commons/')

  // And the listing agrees: no numbers anywhere in commons.
  await type(page, 'look')
  await expect(scrollback(page)).toContainText('commons keeps nothing')
})

test('a room that keeps things says what the number is for', async ({ page }) => {
  await page.goto('/music')
  await type(page, 'say found my dad’s records')
  await type(page, 'ryan')
  await type(page, 'ryan@example.com')

  await expect(scrollback(page)).toContainText('music/')
  // The half that was missing: the number is an address, not a receipt.
  await expect(scrollback(page)).toContainText('that’s where it lives')
})

test('help in commons offers nothing commons cannot do', async ({ page }) => {
  await page.goto('/commons')
  await type(page, 'help')

  // `go` here means another room, not a post there are none of.
  await expect(scrollback(page)).toContainText('go — go to another room')

  /*
   * `reply` was left off this list, on the reasoning that it could never work
   * here: §3.10 gives commons no threads and the schema refuses them, so
   * listing it would be advertising a dead end. Naming a post changed that —
   * the reply is not going *in* commons, it is going to music — and a verb
   * that works from here belongs on the list of what you can type from here.
   */
  await expect(scrollback(page)).toContainText('reply — answer a post')

  // Answering nothing in particular still says what commons cannot do, and
  // then names the thing that does work from here (§3.7).
  await type(page, 'reply nice one')
  await expect(scrollback(page)).toContainText('commons keeps nothing')
})

test('tapping an address types the reply for you, and does not send it', async ({ page }) => {
  /*
   * "What happens when we're on reply 239482 — typing that number in each time
   * will be real annoying." Post numbers are the ones that grow (they are
   * allocated per room), and answering means typing back a number already on
   * the screen.
   *
   * The contract is the palette's, and it is the important half: tapping
   * *inserts* and never runs. A button that posted something would make this a
   * button UI in a terminal costume (§9) — and would post an empty reply.
   */
  await page.goto('/music')
  const address = page.getByTestId('tap').first()
  const number = await address.textContent()

  await address.tap()

  await expect(prompt(page)).toHaveValue(`reply ${number} `)
  // Nothing ran: no confirmation, and no signup question either.
  await expect(scrollback(page)).not.toContainText('what do you want to be called')
  await expect(scrollback(page)).not.toContainText('just now')
})

test('and the keyboard stays up, with the cursor at the end', async ({ page }) => {
  // Tapping anything that steals focus closes the keyboard on a phone, which
  // costs a tap to reopen and scrolls the page out from under you.
  await page.goto('/music')
  await page.getByTestId('tap').first().tap()

  await expect(prompt(page)).toBeFocused()
  const [start, end] = await prompt(page).evaluate((el: HTMLInputElement) => [
    el.selectionStart,
    el.selectionEnd,
  ])
  expect(start).toBe(await prompt(page).inputValue().then((v) => v.length))
  expect(end).toBe(start)
})

test('the address is big enough to hit with a thumb', async ({ page }) => {
  /*
   * WCAG 2.5.5, and §8's kill condition in miniature: a single digit at 15px
   * monospace is about nine pixels wide, which is not a target. The padding
   * that fixes it is invisible — horizontal padding cancelled by an equal
   * negative margin, vertical padding on an inline box, which does not affect
   * the line at all.
   */
  await page.goto('/music')
  const box = await page.getByTestId('tap').first().boundingBox()

  expect(box!.width).toBeGreaterThanOrEqual(24)
  expect(box!.height).toBeGreaterThanOrEqual(24)
})

test('and the column of addresses does not move to make room for it', async ({ page }) => {
  /*
   * The reason the padding is cancelled rather than simply added. Every listing
   * on this site prints `address  who, when` so a column of them can be read
   * down; a button that shifted its own text right by eight pixels would break
   * that alignment on exactly the lines it was added to, and nothing else in
   * the suite looks at pixels.
   */
  await page.goto('/music')
  // Same reason as below: `evaluate` does not retry, and an empty list here
  // would read as "nothing drifted" rather than "nothing was measured".
  await expect(page.getByTestId('tap').first()).toBeVisible()

  const drift = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.line-tap')]
    return buttons.map((button) => {
      const range = document.createRange()
      range.selectNodeContents(button)
      // Where the address's first character actually sits, against where the
      // line it belongs to begins.
      return range.getBoundingClientRect().left - button.closest('p')!.getBoundingClientRect().left
    })
  })

  expect(drift.length).toBeGreaterThan(0)
  for (const offset of drift) expect(Math.abs(offset)).toBeLessThan(1)
})

test('a five-digit address still fits on a 380px screen', async ({ page }) => {
  /*
   * The case this was built for: `post_no` is allocated per room and never
   * reused, so a room busy for a year hands out `239482` rather than `12`. The
   * address is `white-space: pre` so a number can never break in half — which
   * means a long one cannot wrap its way out of trouble, and §8 makes a
   * horizontal scrollbar at 380px the kill condition.
   *
   * Done against the real line, with the real classes, because this is a CSS
   * property and nothing else in the suite would notice it.
   */
  await page.goto('/music')
  // Waited for rather than assumed: `evaluate` does not retry, and the room
  // listing arrives a moment after the prompt does.
  await expect(page.getByTestId('tap').first()).toBeVisible()

  await page.evaluate(() => {
    const button = document.querySelector<HTMLElement>('.line-tap')!
    button.textContent = '239482'
    // The longest address the site can produce: somebody's wall, and a name at
    // the 20-character limit.
    const line = button.closest('p')!
    const clone = line.cloneNode(true) as HTMLElement
    clone.querySelector('.line-tap')!.textContent = '~averylongnamehere12/239482'
    line.after(clone)
  })

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
