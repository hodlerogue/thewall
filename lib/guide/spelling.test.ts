import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The site's own words are American, and nothing was keeping them that way.
 *
 * Reported as "theme says 'change the colours', I'm in US not UK" — and it was
 * not one line. A sweep found seven: the theme gloss, "a fortnight of silence"
 * in the rundown, "automated defence" and a second fortnight in the terms, and
 * three seeded posts carrying "realised", "neighbours" and "rumour". Every one
 * of them was written by somebody whose default spelling is the other one, and
 * that person will write the next one too.
 *
 * So this reads what the site would print and refuses the whole list.
 *
 * **Only prose, and only what is printed.** Two exclusions, both deliberate:
 * comments are stripped first — the fifth time that has mattered in this
 * codebase — because the reasoning around a line is not the line; and a string
 * with no space in it is not a sentence, which is what lets `colour` stay an
 * *alias*. Somebody who types the British spelling should still be understood.
 * They just should not be answered in it.
 */

/** Everything a person could read on the screen or in an email. */
const SOURCES = [
  'lib/guide/about.ts',
  'lib/legal/documents.ts',
  'lib/shell/fixtures.ts',
  'lib/shell/themes.ts',
  'lib/shell/render.ts',
  'lib/shell/session.ts',
  'lib/shell/errors.ts',
  'lib/shell/hints.ts',
  'lib/commands/registry.ts',
  'lib/commands/run.ts',
  'lib/auth/mail.ts',
  'lib/auth/digest.ts',
  'lib/auth/names.ts',
  'lib/pwa/install.ts',
  'components/Terminal.tsx',
  'components/Shell.tsx',
  'components/Palette.tsx',
  'components/Readable.tsx',
  'app/about/page.tsx',
  'app/legal/Document.tsx',
  'app/layout.tsx',
  'app/manifest.ts',
  'lib/brand/og.tsx',
  'lib/seo/pages.ts',
  'app/opengraph-image.alt.txt',
]

/**
 * The ones this codebase has actually produced, plus the rest of the family.
 *
 * Not exhaustive and not trying to be — a list that flagged every possible
 * difference would flag `practice`, which is a noun in both, and start costing
 * more than it catches.
 */
const BRITISH = [
  /\bcolou?rs?\b(?<=colours?)/i,
  /\brealis(e|ed|es|ing)\b/i,
  /\bneighbours?\b/i,
  /\brumours?\b/i,
  /\bfortnights?\b/i,
  /\bdefence\b/i,
  /\boffence\b/i,
  /\bbehaviours?\b/i,
  /\bfavour(s|ed|ite|ites)?\b/i,
  /\bhonour(s|ed)?\b/i,
  /\blabour(s|ed)?\b/i,
  /\bhumour\b/i,
  /\bflavour(s|ed)?\b/i,
  /\bcentres?\b/i,
  /\bmetres?\b/i,
  /\btheatres?\b/i,
  /\blicence\b/i,
  /\bcatalogue\b/i,
  /\bprogramme\b/i,
  /\bgrey\b/i,
  /\bwhilst\b/i,
  /\bamongst\b/i,
  /\blearnt\b/i,
  /\banalys(e|ed|es|ing)\b/i,
  /\brecognis(e|ed|es|ing)\b/i,
  /\borganis(e|ed|es|ing|ation)\b/i,
  /\bapologis(e|ed|es|ing)\b/i,
  /\bjudgement\b/i,
  /\backnowledgement\b/i,
  /\btravell(ed|ing|er)\b/i,
  /\bcancell(ed|ing)\b/i,
  /\bper cent\b/i,
]

/** Comments are the reasoning around a line, not the line. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/**
 * What the file would actually print.
 *
 * A `.txt` is all prose. Everything else is scanned for string literals, and
 * only the ones containing a space — a sentence is prose, a bare word is an
 * identifier or an alias.
 *
 * A `.tsx` gets one more pass. Half the prose on `/about` and all of the terms
 * page's unfinished-law warning are written as JSX text, between the tags
 * rather than inside quotes — a literals-only scan reads those files and finds
 * nothing to check, which is the same false pass as a typo'd path.
 *
 * The lookbehind is what keeps that pass honest. Without it, the `>` of an
 * arrow function opens a "tag" that runs until the next generic's `<`, and the
 * identifier in between gets read as a sentence. A real tag never ends with an
 * operator or a space in front of its `>`.
 */
const JSX_TEXT = /(?<=[^\s=<>&|+\-*])>([^<>{}]+)</g

function printedProse(path: string, source: string): string[] {
  if (path.endsWith('.txt')) return [source]

  const code = stripComments(source)
  const literals = code.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? []
  const between = path.endsWith('.tsx') ? [...code.matchAll(JSX_TEXT)].map((hit) => hit[1]) : []

  return [...literals, ...between].filter((text) => text.includes(' ') && /[a-z]{2}/i.test(text))
}

describe('the site speaks American', () => {
  it('is reading files that exist and have words in them', () => {
    // A path typo would make this pass by scanning nothing, which is the
    // failure mode every source-reading test in here has had at least once.
    for (const path of SOURCES) {
      const source = readFileSync(join(process.cwd(), path), 'utf8')
      expect(source.length, path).toBeGreaterThan(100)
    }
  })

  it('in every line it prints', () => {
    const found: string[] = []

    for (const path of SOURCES) {
      const source = readFileSync(join(process.cwd(), path), 'utf8')
      for (const prose of printedProse(path, source)) {
        for (const british of BRITISH) {
          const hit = british.exec(prose)
          if (hit) found.push(`${path}: ${hit[0]} — ${prose.slice(0, 70)}`)
        }
      }
    }

    expect(found).toEqual([])
  })

  it('and in the seed, which is the first thing anybody reads', () => {
    // The posts the site ships as its own example of good content. Three of
    // them were British, and they are the words a visitor sees before any of
    // the interface's own.
    const seed = readFileSync(join(process.cwd(), 'supabase/seed.sql'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*/g, '')

    for (const british of BRITISH) {
      expect(british.exec(seed)?.[0], `${british} is in the seed`).toBeUndefined()
    }
  })

  it('while still understanding somebody who types the other spelling', () => {
    /*
     * The line this stops at. `colour` stays an alias — somebody who spells it
     * that way should be understood, they just should not be answered in it.
     * A rule that scanned every string would have deleted that, which is why it
     * only looks at strings with a space in them.
     */
    const registry = readFileSync(join(process.cwd(), 'lib/commands/registry.ts'), 'utf8')
    expect(registry).toContain("'colour'")
    expect(registry).toContain("'colours'")
  })
})
