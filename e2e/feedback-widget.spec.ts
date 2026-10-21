import { expect, test, type Page } from '@playwright/test'

/**
 * The feedback form widget, in the feedback room and nowhere else.
 *
 * The real widget is somebody else's script on somebody else's server, which
 * is not something a test should depend on — so every request for it is
 * answered with a stand-in that does what any such widget does: reads its form
 * id off the script tag and puts something on the page.
 */

const prompt = (page: Page) => page.getByTestId('prompt-input')
const label = (page: Page) => page.getByTestId('prompt-label')
const widget = (page: Page) => page.locator('#stand-in-widget')

async function type(page: Page, text: string) {
  await prompt(page).fill(text)
  await prompt(page).press('Enter')
}

/*
 * How the stand-in starts, in the three ways widgets commonly do. The first
 * version of this file only had the first, and passed — while the real widget,
 * entered with `go feedback`, did not appear until the page was refreshed.
 * A widget that waits for the page to finish loading waits forever when it
 * arrives on a page that finished loading minutes ago, which is every page
 * here after the first, because walking between rooms never reloads.
 */
const STARTS = {
  'starts at once': 'draw();',
  'waits for DOMContentLoaded': "document.addEventListener('DOMContentLoaded', draw);",
  'waits for window load': "window.addEventListener('load', draw);",
} as const

const standIn = (start: string) => `
  (function () {
    var me = document.currentScript || document.querySelector('script[data-form-id]');
    function draw() {
      if (document.getElementById('stand-in-widget')) return;
      var box = document.createElement('div');
      box.id = 'stand-in-widget';
      box.textContent = 'form ' + me.getAttribute('data-form-id');
      box.style.cssText = 'position:fixed;top:8px;right:8px;display:block;background:#fff;color:#000;padding:4px';
      document.body.appendChild(box);
    }
    ${start}
  })();
`

let requests = 0

for (const [how, start] of Object.entries(STARTS)) {
  test.describe(`a widget that ${how}`, () => {
    test.beforeEach(async ({ page }) => {
      requests = 0
      await page.route('**/widget.js', (route) => {
        requests += 1
        return route.fulfill({ contentType: 'application/javascript', body: standIn(start) })
      })
    })

    test('arriving in the feedback room by link loads the form, with its id', async ({ page }) => {
      await page.goto('/feedback')
      await expect(label(page)).toHaveText('guest:feedback$')

      const script = page.locator('script#feedback-widget')
      await expect(script).toHaveAttribute('src', 'https://formaiproject.netlify.app/widget.js')
      await expect(script).toHaveAttribute('data-form-id', 'frm_052cac48')
      await expect(widget(page)).toBeVisible()
      await expect(widget(page)).toHaveText('form frm_052cac48')
    })

    test('walking in with go loads it too — the page never reloads between rooms', async ({ page }) => {
      await page.goto('/music')
      await expect(label(page)).toHaveText('guest:music$')
      await type(page, 'go feedback')
      await expect(label(page)).toHaveText('guest:feedback$')
      await expect(widget(page)).toBeVisible()
    })

    test('it is not loaded anywhere else', async ({ page }) => {
      await page.goto('/music')
      await expect(label(page)).toHaveText('guest:music$')
      await type(page, 'look')
      await expect(page.locator('script#feedback-widget')).toHaveCount(0)
      expect(requests).toBe(0)
    })

    test('it hides when you leave, comes back when you return, and loads once', async ({ page }) => {
      await page.goto('/feedback')
      await expect(widget(page)).toBeVisible()

      await type(page, 'leave')
      await expect(label(page)).toHaveText('guest:lobby$')
      await expect(widget(page)).toBeHidden()

      // The prompt still works with it hidden: nothing is left over the page.
      await type(page, 'go music')
      await expect(label(page)).toHaveText('guest:music$')
      await expect(widget(page)).toBeHidden()

      await type(page, 'go feedback')
      await expect(widget(page)).toBeVisible()
      await expect(page.locator('script#feedback-widget')).toHaveCount(1)
      expect(requests).toBe(1)
    })

    test('it stays while reading a post inside the feedback room', async ({ page }) => {
      await page.goto('/feedback')
      await expect(widget(page)).toBeVisible()
      await type(page, 'go 1')
      await expect(label(page)).toHaveText('guest:feedback/1$')
      await expect(widget(page)).toBeVisible()
    })
  })
}
