/**
 * Adding this to a home screen, on the two platforms that mean different things
 * by it.
 *
 * **Android and desktop Chrome** fire `beforeinstallprompt`, which can be
 * caught and replayed later. That is the whole reason this file holds a
 * reference: the event arrives when the browser decides, usually seconds after
 * load, and the moment it is worth *offering* is much later. Calling
 * `preventDefault()` on it suppresses the browser's own mini-infobar, which is
 * the point — a banner over a terminal is the one interruption this design has
 * spent every other decision avoiding.
 *
 * **iOS has no equivalent and never has.** There is no API, no event, and no
 * way to trigger the sheet. The only thing that works is telling somebody which
 * two taps to make, which is why `advice()` exists rather than a single
 * `install()` that quietly does nothing on half the phones in the world.
 *
 * Nothing here nags. §8 makes mobile the kill condition and §3.6 makes the
 * interface teach by glossary rather than by interruption, so this is a command
 * you can type, plus at most one line of scrollback, once, ever.
 */

import type { Line } from '@/lib/shell/types'

/** Chrome's event, which is not in lib.dom. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const SHOWN_KEY = 'thewall.install.suggested'

let deferred: InstallPromptEvent | null = null

/**
 * Start listening. Safe to call more than once and safe on the server.
 *
 * The event is captured rather than acted on, because the browser fires it at
 * its own convenience and the useful moment is the one somebody chooses.
 */
export function watchForInstall(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as InstallPromptEvent
  })

  // Once it is installed the offer is noise, and the deferred event is stale.
  window.addEventListener('appinstalled', () => {
    deferred = null
    remember()
  })
}

/** True when this is already running from a home screen or an app window. */
export function installed(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  // iOS predates the media query and answers this instead.
  return (window.navigator as { standalone?: boolean }).standalone === true
}

/** iOS, where the sheet exists and cannot be opened from a page. */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return true
  // iPadOS reports itself as a Mac; the touch points are what give it away.
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1
}

/** Whether the browser has offered us a prompt we can replay. */
export function promptable(): boolean {
  return deferred !== null
}

/**
 * Ask, if the browser will let us. Returns what happened, in the site's voice.
 *
 * Dismissal is not an error and does not apologise: somebody who says no has
 * used the command exactly as intended.
 */
export async function offerInstall(): Promise<Line[]> {
  if (installed()) {
    return [{ text: 'it’s already on your home screen.', tone: 'faint' }]
  }

  const event = deferred
  if (event) {
    // One shot. Chrome will not replay a consumed prompt, so holding on to it
    // would leave `install` silently doing nothing the second time.
    deferred = null
    remember()
    try {
      await event.prompt()
      const { outcome } = await event.userChoice
      return outcome === 'accepted'
        ? [{ text: 'added. it opens without the browser chrome now.', tone: 'faint' }]
        : [{ text: 'no problem. type install if you change your mind.', tone: 'faint' }]
    } catch {
      return [{ text: 'your browser wouldn’t open the prompt. the menu will have it.', tone: 'faint' }]
    }
  }

  return advice()
}

/**
 * What to do by hand, per platform.
 *
 * Named after what it is. iOS gets the two taps because that is the only route
 * there is; everybody else gets the menu, because a browser that has not
 * offered us a prompt has usually either installed it already or decided the
 * page is not eligible, and neither is worth explaining.
 */
export function advice(): Line[] {
  if (isIOS()) {
    return [
      { text: 'on iphone: tap share, then add to home screen.', tone: 'faint' },
      { text: 'it opens full screen after that, with the keyboard where you expect it.', tone: 'faint' },
    ]
  }
  return [
    { text: 'your browser’s menu will have "install" or "add to home screen".', tone: 'faint' },
  ]
}

/**
 * Whether to mention it unasked, which is a different question from whether it
 * would work.
 *
 * Once ever, and only to somebody who has a name — which means either they came
 * back, or they have just been through signup and decided this is worth an
 * account. Suggesting it to a first-time reader thirty seconds in is the banner
 * this file exists to avoid.
 */
export function shouldSuggest(named: boolean): boolean {
  if (typeof window === 'undefined') return false
  if (!named || installed()) return false
  try {
    if (localStorage.getItem(SHOWN_KEY)) return false
  } catch {
    // Private browsing. Better to say nothing than to say it every load.
    return false
  }
  return isIOS() || promptable()
}

/** The line itself, and the record that it has been said. */
export function suggestion(): Line[] {
  remember()
  return [
    {
      text: isIOS()
        ? 'you can keep this on your home screen — share, then add to home screen.'
        : 'you can keep this on your home screen — type install.',
      tone: 'faint',
    },
  ]
}

function remember(): void {
  try {
    localStorage.setItem(SHOWN_KEY, '1')
  } catch {
    // Nothing to do, and nothing worth saying about it.
  }
}
