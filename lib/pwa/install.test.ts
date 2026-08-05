import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Adding this to a home screen, and the two things that are easy to get wrong.
 *
 * One: iOS has no install API and never has, so a single `install()` that calls
 * a browser prompt would silently do nothing on half the phones in the world —
 * which on the platform §8 names as the kill condition is not a small gap.
 *
 * Two: the suggestion must be a suggestion. The browser's own mini-infobar is
 * suppressed so this can be asked for rather than interrupted with, and a line
 * of scrollback that reappears every load is that infobar in a costume.
 */

const store = new Map<string, string>()

function browser(options: { ua?: string; standalone?: boolean; touch?: number } = {}) {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
  vi.stubGlobal('navigator', {
    userAgent: options.ua ?? 'Mozilla/5.0 (Linux; Android 14) Chrome/120',
    maxTouchPoints: options.touch ?? 0,
    standalone: options.standalone,
  })
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false }),
    navigator: { standalone: options.standalone },
    addEventListener: () => {},
  })
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari'

beforeEach(() => browser())
afterEach(() => vi.unstubAllGlobals())

describe('which platform this is', () => {
  it('knows an iphone', async () => {
    browser({ ua: IPHONE })
    const { isIOS } = await import('@/lib/pwa/install')
    expect(isIOS()).toBe(true)
  })

  it('knows an ipad, which claims to be a mac', async () => {
    // iPadOS reports a Macintosh user agent. Touch points are what give it
    // away, and without this every iPad would be told to use a menu it has not
    // got.
    browser({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', touch: 5 })
    const { isIOS } = await import('@/lib/pwa/install')
    expect(isIOS()).toBe(true)
  })

  it('does not mistake a real mac for one', async () => {
    browser({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', touch: 0 })
    const { isIOS } = await import('@/lib/pwa/install')
    expect(isIOS()).toBe(false)
  })
})

describe('what it tells you to do', () => {
  it('gives an iphone the two taps, because nothing else works there', async () => {
    browser({ ua: IPHONE })
    const { advice } = await import('@/lib/pwa/install')
    const text = advice().map((l) => l.text).join('\n')

    expect(text).toContain('share')
    expect(text).toContain('add to home screen')
    // Never tells an iPhone to type a command that cannot work there.
    expect(text).not.toContain('type install')
  })

  it('points everybody else at the menu', async () => {
    const { advice } = await import('@/lib/pwa/install')
    expect(advice().map((l) => l.text).join('\n')).toContain('menu')
  })

  it('says so when it is already installed, rather than offering again', async () => {
    vi.resetModules()
    browser()
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }), addEventListener: () => {} })
    const { offerInstall } = await import('@/lib/pwa/install')
    const text = (await offerInstall()).map((l) => l.text).join('\n')
    expect(text).toContain('already on your home screen')
  })
})

describe('when it speaks unasked', () => {
  it('says nothing to somebody without a name', async () => {
    browser({ ua: IPHONE })
    const { shouldSuggest } = await import('@/lib/pwa/install')
    // A first-time reader thirty seconds in. §3.9 has not even asked who they
    // are yet, and this would be the first thing the site wanted from them.
    expect(shouldSuggest(false)).toBe(false)
  })

  it('says it once, and then never again', async () => {
    browser({ ua: IPHONE })
    const { shouldSuggest, suggestion } = await import('@/lib/pwa/install')

    expect(shouldSuggest(true)).toBe(true)
    suggestion()
    expect(shouldSuggest(true)).toBe(false)
  })

  it('says nothing when it is already installed', async () => {
    vi.resetModules()
    browser({ ua: IPHONE })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }), addEventListener: () => {} })
    const { shouldSuggest } = await import('@/lib/pwa/install')
    expect(shouldSuggest(true)).toBe(false)
  })

  it('stays quiet rather than repeating itself where nothing can be remembered', async () => {
    // Private browsing: localStorage throws. Saying it every single load is
    // worse than never saying it, so silence is the failure mode.
    vi.resetModules()
    browser({ ua: IPHONE })
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    const { shouldSuggest } = await import('@/lib/pwa/install')
    expect(shouldSuggest(true)).toBe(false)
  })

  it('does not offer a prompt on android before the browser has given us one', async () => {
    // Chrome fires `beforeinstallprompt` when it decides the page is eligible.
    // Until then there is nothing to replay, and an offer would be a dead end.
    vi.resetModules()
    browser()
    const { shouldSuggest } = await import('@/lib/pwa/install')
    expect(shouldSuggest(true)).toBe(false)
  })

  it('offers one line, not a paragraph', async () => {
    browser({ ua: IPHONE })
    const { suggestion } = await import('@/lib/pwa/install')
    expect(suggestion()).toHaveLength(1)
    expect(suggestion()[0].tone).toBe('faint')
  })
})
