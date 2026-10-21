import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * No page that shows what people said may be built once and kept.
 *
 * /lobby was. Nothing in it asked for anything per-request, so Next prerendered
 * it at deploy time, rooms and all — and that snapshot is what showed until the
 * prompt finished loading, which is a long time on a slow phone and forever for
 * a search engine. QA found it as the lobby advertising a commons post that
 * commons, a day later, no longer had.
 *
 * `<Readable>` is what puts live content into a page's HTML. Any page using it
 * has to be per-request: either because its address has a parameter in it
 * (`[room]`), which already does that, or because it calls `connection()`.
 * The build output is the real proof — `ƒ`, not `○` — but nothing reads that
 * on every run, and this is the line that would have to be deleted to bring
 * the bug back.
 */

const app = join(__dirname, '..', '..', 'app')

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return pages(path)
    return name === 'page.tsx' ? [path] : []
  })
}

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const live = pages(app).filter((page) => /<Readable\b/.test(strip(readFileSync(page, 'utf8'))))

describe('pages that show what people said', () => {
  it('are found, so the check below means something', () => {
    expect(live.map((page) => relative(app, page)).sort()).toContain('lobby/page.tsx')
    expect(live.length).toBeGreaterThan(2)
  })

  for (const page of live) {
    const where = relative(app, page)
    it(`${where} is drawn per visit`, () => {
      const perRequestAddress = /\[[^\]]+\]/.test(where)
      const asksForARequest = /await connection\(\)/.test(strip(readFileSync(page, 'utf8')))
      expect(perRequestAddress || asksForARequest, `${where} would be prerendered at deploy and go stale`).toBe(true)
    })
  }
})
