import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * One read per address per request, and a guard that is honest about its reach.
 *
 * A room page is rendered by two things that do not know about each other:
 * `generateMetadata`, which needs the room to write the title, and `Readable`,
 * which needs the room to draw the page. Both called `getRoom(slug)`. Measured
 * against the built server with the reader instrumented and one request per
 * page: **two reads for `/music`, two for `/music/12`, two for `/~marisol`.**
 * With the readers wrapped in React's `cache()`, one each. Nothing else changed
 * between the two measurements.
 *
 * **This test cannot re-run that measurement**, and it is worth saying why
 * rather than implying otherwise. `cache()` only memoises inside the React
 * Server Component runtime; imported into vitest it is a pass-through, and even
 * `renderToStaticMarkup` does not establish the scope (checked: three calls
 * stayed three). A test that asserted "the second call is free" would pass by
 * measuring the wrong thing, or fail while the app was fine.
 *
 * So it guards the arrangement instead: the readers are wrapped, and the two
 * callers go through them rather than reaching for `ogEnv` and calling the
 * database themselves. That is the part a future edit would plausibly undo by
 * accident — adding a read to `Readable` the direct way, because the direct way
 * is what the surrounding code used to look like.
 */

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('a page reads each address once', () => {
  const readers = ['readLobby', 'readRoom', 'readProfile', 'readPost']

  it.each(readers)('%s is memoised per request', (name) => {
    const line = source('lib/brand/ogData.ts')
      .split('\n')
      .find((l) => l.includes(`export const ${name} =`))

    expect(line, `${name} is not exported from ogData`).toBeDefined()
    expect(line, `${name} must be wrapped in cache() or every caller pays again`).toContain(
      'cache(',
    )
  })

  // The reads themselves are `env.getRoom` and friends. A caller holding an
  // `Env` can make one whenever it likes, which is exactly what both of these
  // used to do.
  for (const path of ['components/Readable.tsx', 'lib/seo/pages.ts']) {
    it(`${path} reads through them rather than around them`, () => {
      const text = source(path)

      expect(text, `${path} imports the cached readers`).toMatch(
        /import \{[^}]*read(Lobby|Room|Profile|Post)[^}]*\} from '@\/lib\/brand\/ogData'/,
      )
      // `ogEnv()` is still the right thing for a share card, which is one read
      // and does not share a request with anything. It is the wrong thing here.
      expect(text.includes('ogEnv('), `${path} builds its own reader`).toBe(false)
      expect(text, `${path} calls a read directly`).not.toMatch(
        /env\.(getRoom|getPost|getProfile|listRooms)\(/,
      )
    })
  }
})
