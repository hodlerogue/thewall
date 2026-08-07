import { expect, test, type Page } from '@playwright/test'

/**
 * §4.2, reopened, walked on a phone.
 *
 * The doc closes room creation because "40 rooms with three people each kills
 * the entire feeling". Creation is open now, so what has to be true is the
 * thing that warning was actually about: the lobby.
 */

const prompt = (page: Page) => page.getByTestId('prompt-input')
const scrollback = (page: Page) => page.getByTestId('scrollback')
const label = (page: Page) => page.getByTestId('prompt-label')

async function type(page: Page, text: string) {
  await prompt(page).fill(text)
  await prompt(page).press('Enter')
}

async function withName(page: Page) {
  await page.goto('/music')
  await type(page, 'say something to make an account with')
  await type(page, 'roommaker')
  await type(page, 'roommaker@example.com')
  await expect(label(page)).toHaveText('roommaker:music$')
}

test('make walks you into the room it just made, and the url follows', async ({ page }) => {
  await withName(page)

  await type(page, 'make garden what you are growing')
  await expect(scrollback(page)).toContainText('garden is open')
  await expect(label(page)).toHaveText('roommaker:garden$')
  await expect(page).toHaveURL(/\/garden$/)

  // §5 — an empty room is worse than no room, so it says what to do about it.
  await expect(scrollback(page)).toContainText('nothing here yet')

  // And it is a real room: you can say something in it like any other.
  await type(page, 'say four tomato plants and a lot of optimism')
  await expect(scrollback(page)).toContainText('garden/')
})

test('a new room is in the lobby, under the curated ones', async ({ page }) => {
  await withName(page)
  await type(page, 'make garden what you are growing')

  await type(page, 'leave')
  const lines = await scrollback(page).innerText()
  expect(lines).toContain('garden')
  // The furniture is still the furniture, and still first.
  expect(lines.indexOf('commons')).toBeLessThan(lines.lastIndexOf('garden'))
})

test('make asks what a room is for, and opens it on the answer', async ({ page }) => {
  // `make onions` used to be refused with "try: make onions what you are
  // growing" — an example carrying a different room's description, which got
  // copied verbatim, because an example you are told to try is an instruction.
  await withName(page)

  await type(page, 'make onions')
  await expect(scrollback(page)).toContainText('what is onions for?')
  await expect(scrollback(page)).not.toContainText('what you are growing')

  await type(page, 'the allium bed, and what to do with it')
  await expect(scrollback(page)).toContainText('onions is open')
  // The prompt follows, which is the half that is easy to leave out.
  await expect(label(page)).toHaveText('roommaker:onions$')
  await expect(page).toHaveURL(/\/onions$/)
})

test('the docs are somewhere you can see them in help', async ({ page }) => {
  // "I can't find how to get to the docs in thewall." They were listed
  // thirteenth and fourteenth of fifteen, below the fold on a phone.
  await page.goto('/music')
  await type(page, 'help')

  await expect(scrollback(page)).toContainText('and anywhere:')
  await expect(scrollback(page)).toContainText('terms — ')
  await expect(scrollback(page)).toContainText('privacy — ')

  // And they work from where they are named.
  await type(page, 'terms')
  await expect(scrollback(page)).toContainText('what you write stays yours')
})

test('a room name already taken points at the room that has it', async ({ page }) => {
  await withName(page)
  await type(page, 'make music more music')
  await expect(scrollback(page)).toContainText('already exists')
  await expect(scrollback(page)).toContainText('go music')
})

test('making a room is not something a guest is asked to sign up for', async ({ page }) => {
  await page.goto('/lobby')
  await type(page, 'make garden what you are growing')
  await expect(scrollback(page)).toContainText('you need a name first')
  // §3.9 asks at the moment of contribution, when there is a held sentence to
  // hand back. There is none here, so the ask would arrive empty.
  await expect(scrollback(page)).not.toContainText('what do you want to be called')
})

test('make is in help from everywhere, and explains itself', async ({ page }) => {
  for (const path of ['/lobby', '/music', '/commons']) {
    await page.goto(path)
    await type(page, 'help')
    await expect(scrollback(page), path).toContainText('make — create a new room')
  }

  await type(page, 'what make')
  await expect(scrollback(page)).toContainText('three a week')
  // The alias, named where a terminal-literate reader goes looking for it.
  await expect(scrollback(page)).toContainText('create')
})

test('find --rooms searches names and what rooms are for', async ({ page }) => {
  await page.goto('/lobby')

  await type(page, 'find --rooms kitchen')
  await expect(scrollback(page)).toContainText('what you cooked')

  // The half people forget they need: you remember what it was for.
  await type(page, 'find --rooms listening')
  await expect(scrollback(page)).toContainText('music')
  await expect(scrollback(page)).toContainText('go music to walk in')
})

test('a word that is a room name, not something said, points at the room', async ({ page }) => {
  await page.goto('/lobby')
  await type(page, 'find latenight')
  await expect(scrollback(page)).toContainText('nothing said about latenight')
  await expect(scrollback(page)).toContainText('quiet hours only')
})

test('--room still filters posts, which --rooms must not have taken over', async ({ page }) => {
  await page.goto('/lobby')
  await type(page, 'find --room=music records')
  await expect(scrollback(page)).toContainText('music/12')
})


test('feed is in the lobby, and the walls are not', async ({ page }) => {
  await page.goto('/lobby')

  // The arrangement in one assertion: one room in the listing holds what is on
  // every wall, so a door per person is not needed and §4.2 stays honoured.
  await expect(scrollback(page)).toContainText('feed')
  await expect(scrollback(page)).not.toContainText('~')
})

test('the feed shows walls, with the whole address on every line', async ({ page }) => {
  await page.goto('/lobby')
  await type(page, 'go feed')

  await expect(label(page)).toHaveText('guest:feed$')
  await expect(scrollback(page)).toContainText('~marisol/2')
  await expect(scrollback(page)).toContainText('neighbours own fans')

  // And the address it printed is the address `go` takes.
  await type(page, 'go ~marisol/2')
  await expect(label(page)).toHaveText('guest:~marisol/2$')
})

test('a bare number on the feed is refused, since it names two posts at once', async ({ page }) => {
  await page.goto('/feed')
  await type(page, 'go 2')
  await expect(scrollback(page)).toContainText('needs the name')
})

test('saying something on the feed puts it on your own wall', async ({ page }) => {
  await page.goto('/feed')
  await type(page, 'say a thing for my own wall')
  await type(page, 'wallposter')
  await type(page, 'wallposter@example.com')

  // §3.9 — the held sentence lands, and the wall it lands on is the one the
  // name it was just given owns. There was no `~name` to write down when the
  // sentence was captured.
  await expect(scrollback(page)).toContainText('the thing you were trying to say is up')
  await expect(scrollback(page)).toContainText('~wallposter/')
})


test('arriving at /feed from a link shows the feed, not an empty room', async ({ page }) => {
  /*
   * `go feed` was special-cased and this was not, so the bug lived on exactly
   * one route — the URL somebody arrives at from a link, which is the first
   * thing anybody sent here would see.
   */
  await page.goto('/feed')

  await expect(label(page)).toHaveText('guest:feed$')
  await expect(scrollback(page)).toContainText('~marisol/2')
  await expect(scrollback(page)).not.toContainText('nothing here yet')
})

test('the lobby line for feed comes from the walls it shows', async ({ page }) => {
  await page.goto('/lobby')
  const lobby = await scrollback(page).innerText()

  const at = lobby.indexOf('feed')
  expect(at).toBeGreaterThan(-1)
  // Whatever follows it must not be the empty-room line.
  expect(lobby.slice(at, at + 80)).not.toContain('quiet in here')
})

test('what you say on the feed comes back with an address that works there', async ({ page }) => {
  await page.goto('/feed')
  await type(page, 'say a thing for my own wall')
  await type(page, 'addressee')
  await type(page, 'addressee@example.com')

  // `go 7` is refused on the feed, so telling somebody to type it would be an
  // instruction that fails when followed.
  await expect(scrollback(page)).toContainText('~addressee/')
})

test('a room made from inside a room is listed at the bottom of that room', async ({ page }) => {
  /*
   * "Can you create a room within a room? Maybe 3-5 deep, for subtopics." This
   * is what got built instead of nesting, and this is the walk that proves it:
   * the new room's address has no parent in it, and the parent has one line
   * saying where people went.
   */
  await withName(page)

  await type(page, 'make bebop the fast stuff')
  // A plain top-level address. Not /music/bebop — nothing is inside anything.
  await expect(page).toHaveURL(/\/bebop$/)
  await expect(label(page)).toHaveText('roommaker:bebop$')

  await type(page, 'go music')
  await expect(scrollback(page)).toContainText('grew out of here')
  await expect(scrollback(page)).toContainText('bebop — the fast stuff')

  // The line is navigation: typing what it shows walks you there.
  await type(page, 'go bebop')
  await expect(label(page)).toHaveText('roommaker:bebop$')
})

test('a room made from the lobby is nobody’s subtopic', async ({ page }) => {
  await withName(page)
  await type(page, 'leave')
  await type(page, 'make garden what you are growing')

  await type(page, 'go music')
  await expect(scrollback(page)).not.toContainText('grew out of here')
})

test('create is on the help list, under the word somebody would look for', async ({ page }) => {
  // Reported as "create doesn't appear to be showing in the help menu". It was
  // there, glossed "start a new room" — the right verb and the wrong word.
  await page.goto('/music')
  await type(page, 'help')

  const lines = (await scrollback(page).innerText()).split('\n')
  const make = lines.find((line) => line.startsWith('make —'))
  expect(make).toContain('create')
})
