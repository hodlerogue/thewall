/**
 * §4.5, made a choice rather than left as a default.
 *
 * The document parked green-on-black as "the obvious choice worth departing
 * from" (§9) and left the wider taste call — how quiet this should be —
 * explicitly unresolved, asking only that it be decided deliberately. Four
 * palettes is that decision: the quiet one can stay quiet, because a legible
 * one is one word away.
 *
 * Every palette is checked against WCAG AA in themes.test.ts. That is not
 * ceremony — the warm `faint` was 3.14:1 and the chip gloss 2.95:1, and the
 * gloss is the exact text §3.6 says makes this legible to people who have
 * never opened a terminal. The teaching mechanism was the least readable thing
 * on the screen.
 */

export interface Theme {
  name: string
  gloss: string
  tokens: Record<string, string>
}

export const THEMES: readonly Theme[] = [
  {
    name: 'warm',
    gloss: 'lamplight, the default',
    tokens: {
      '--bg': '#14100c',
      '--bg-raised': '#221c15',
      '--fg': '#e9dcc6',
      '--fg-dim': '#c3b294',
      '--fg-faint': '#a1917a',
      '--accent': '#e0a33e',
      '--accent-dim': '#b07f2f',
      '--error': '#ec8a63',
      '--rule': '#3d3327',
    },
  },
  {
    name: 'black',
    gloss: 'true black, the most legible',
    tokens: {
      '--bg': '#000000',
      '--bg-raised': '#141414',
      '--fg': '#f2f2f2',
      '--fg-dim': '#c9c9c9',
      '--fg-faint': '#a3a3a3',
      '--accent': '#ffb454',
      '--accent-dim': '#c98a37',
      '--error': '#ff8f6b',
      '--rule': '#3a3a3a',
    },
  },
  {
    name: 'green',
    gloss: 'phosphor, the obvious one',
    tokens: {
      '--bg': '#000000',
      '--bg-raised': '#08150c',
      '--fg': '#33ff66',
      '--fg-dim': '#2ad755',
      '--fg-faint': '#22b447',
      '--accent': '#8dffb0',
      '--accent-dim': '#33ff66',
      '--error': '#ff8f6b',
      '--rule': '#14512a',
    },
  },
  {
    name: 'light',
    gloss: 'paper, for daylight',
    tokens: {
      '--bg': '#f6f2e9',
      '--bg-raised': '#ebe5d7',
      '--fg': '#1b1710',
      '--fg-dim': '#4a4234',
      '--fg-faint': '#635948',
      '--accent': '#8a5600',
      '--accent-dim': '#6d4400',
      '--error': '#a63513',
      '--rule': '#c9c0ad',
    },
  },
]

export const DEFAULT_THEME = 'warm'

export function findTheme(name: string): Theme | undefined {
  return THEMES.find((theme) => theme.name === name.toLowerCase().trim())
}

/**
 * Written as one blob so it can be inlined before first paint. Without that a
 * visitor who chose black gets a flash of the warm ground on every load, which
 * is exactly the sort of thing that makes a site feel provisional.
 */
export function themeCss(): string {
  return THEMES.map((theme) => {
    const body = Object.entries(theme.tokens)
      .map(([token, value]) => `  ${token}: ${value};`)
      .join('\n')
    const selector =
      theme.name === DEFAULT_THEME
        ? `:root, :root[data-theme='${theme.name}']`
        : `:root[data-theme='${theme.name}']`
    return `${selector} {\n${body}\n}`
  }).join('\n\n')
}
