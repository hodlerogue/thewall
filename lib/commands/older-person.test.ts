import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv } from '@/lib/shell/env'
import type { Room } from '@/lib/shell/model'
import { OLDER_SAID, PROFILE_PAGE, renderFeed, FEED_PAGE } from '@/lib/shell/render'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import type { Line, Location } from '@/lib/shell/types'

/*
 * "go ~name" stopped at ten and nothing went further back, while the feed's
 * footer sent people there for exactly that.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')
const PAGE: Location = { person: 'marisol' }

function said(count: number): Room[] {
  return [
    {
      slug: 'music',
      gloss: 'talking about music',
      ephemeral: false,
      posts: Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        author: 'marisol',
        body: `thing number ${i + 1}.`,
        createdAt: new Date(Date.now() - (count - i) * 60_000),
        replies: [],
      })),
    },
  ]
}

function harness(count: number) {
  const people = [{ name: 'marisol', joinedAt: new Date(0), verified: true }]
  const env = fixtureEnv(said(count), people)
  const session = new Session({} as SignupApi, {} as Writer, null)
  return createRunner(env, ['commons'], session)
}

describe('older on somebody’s page', () => {
  it('says the page is the newest ten, when it is', async () => {
    const run = harness(50)
    const out = text((await run('go ~marisol', {})).lines)
    expect(out).toContain(`the newest ${PROFILE_PAGE}. older goes back further.`)
    expect(out).toContain('what marisol has said — on the wall and in rooms.')
  })

  it('says nothing of the kind when that is everything', async () => {
    const run = harness(3)
    expect(text((await run('go ~marisol', {})).lines)).not.toContain('the newest')
  })

  it('brings the ones before the page, then the ones before those', async () => {
    const run = harness(45)
    await run('go ~marisol', {})

    const first = text((await run('older', PAGE)).lines)
    expect(first).toContain('thing number 35.') // the eleventh newest
    expect(first).toContain(`thing number ${35 - OLDER_SAID + 1}.`)
    expect(first).not.toContain('thing number 36.')
    expect(first).toContain('older again for more.')

    const second = text((await run('older', PAGE)).lines)
    expect(second).toContain('thing number 15.')
    expect(second).toContain('thing number 1.')
    expect(second).not.toContain('thing number 16.')
    expect(second).toContain('that’s as far back as it goes.')
  })

  it('starts again after look, like a room does', async () => {
    const run = harness(45)
    await run('go ~marisol', {})
    await run('older', PAGE)
    await run('look', PAGE)
    expect(text((await run('older', PAGE)).lines)).toContain('thing number 35.')
  })

  it('has nothing to add when the page was all of it', async () => {
    const run = harness(3)
    await run('go ~marisol', {})
    expect(text((await run('older', PAGE)).lines)).toContain('that’s all of it')
  })
})

describe('the three things are told apart', () => {
  it('the feed says what it is, and its footer is true', () => {
    const full = Array.from({ length: FEED_PAGE }, (_, i) => ({
      room: '~marisol',
      id: i + 1,
      author: 'marisol',
      body: 'hello',
      createdAt: new Date(),
    }))
    const out = text(renderFeed(full))
    expect(out).toContain('what people started on their own walls, from everyone.')
    expect(out).toContain('go ~name, then older')
    expect(out).not.toContain('a wall does')
  })

  it('help and the manual draw the same line', async () => {
    const run = harness(1)
    const help = text((await run('help', {})).lines)
    expect(help).toContain('go feed — the newest posts from everybody’s walls')
    expect(help).toContain('go ~name — one person: their wall, and all they’ve said')
    expect(text((await run('help all', {})).lines)).toContain('older — on somebody’s page')
  })
})
