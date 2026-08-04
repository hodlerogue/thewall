import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, THEMES, findTheme, themeCss } from '@/lib/shell/themes'

/**
 * Contrast, computed rather than eyeballed.
 *
 * This suite exists because the warm palette shipped with `faint` at 3.14:1 and
 * the chip gloss at 2.95:1 — below even the large-text floor — and the gloss is
 * the exact text §3.6 says carries the whole design for people who have never
 * opened a terminal. Nobody noticed because nothing measured it.
 */

function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function ratio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** Text tokens, and which ground each is actually rendered on. */
const ON_BACKGROUND = ['--fg', '--fg-dim', '--fg-faint', '--accent', '--error']
/** The chip gloss and verb sit on the raised ground, not the base one. */
const ON_RAISED = ['--fg-faint', '--accent', '--fg-dim']

describe('every theme is readable (WCAG AA, 4.5:1)', () => {
  for (const theme of THEMES) {
    for (const token of ON_BACKGROUND) {
      it(`${theme.name}: ${token} on --bg`, () => {
        const measured = ratio(theme.tokens[token], theme.tokens['--bg'])
        expect(measured, `${measured.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      })
    }

    for (const token of ON_RAISED) {
      it(`${theme.name}: ${token} on --bg-raised`, () => {
        const measured = ratio(theme.tokens[token], theme.tokens['--bg-raised'])
        expect(measured, `${measured.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

describe('the palettes hold together', () => {
  it('every theme defines the same tokens', () => {
    const expected = Object.keys(THEMES[0].tokens).sort()
    for (const theme of THEMES) {
      expect(Object.keys(theme.tokens).sort(), theme.name).toEqual(expected)
    }
  })

  it('the default exists and is one of them', () => {
    expect(findTheme(DEFAULT_THEME)).toBeDefined()
  })

  it('names are single lowercase words, because you have to type them', () => {
    for (const theme of THEMES) {
      expect(theme.name, theme.name).toMatch(/^[a-z]+$/)
      expect(theme.gloss.length, theme.name).toBeGreaterThan(3)
    }
  })

  it('is found case-insensitively and with stray spaces', () => {
    expect(findTheme('  BLACK ')?.name).toBe('black')
    expect(findTheme('nonsense')).toBeUndefined()
  })

  it('emits css where the default also answers to its own name', () => {
    const css = themeCss()
    expect(css).toContain(`:root, :root[data-theme='${DEFAULT_THEME}']`)
    for (const theme of THEMES) {
      expect(css, theme.name).toContain(theme.tokens['--bg'])
    }
  })

  it('the rule colour stays a hairline, not text', () => {
    // --rule is a border. It is deliberately NOT held to 4.5:1, but it should
    // at least be visible against its ground.
    for (const theme of THEMES) {
      const measured = ratio(theme.tokens['--rule'], theme.tokens['--bg'])
      expect(measured, `${theme.name} ${measured.toFixed(2)}:1`).toBeGreaterThanOrEqual(1.4)
    }
  })
})
