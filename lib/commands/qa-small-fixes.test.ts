import { describe, expect, it } from 'vitest'
import { createRunner } from '@/lib/commands/run'
import { fixtureEnv } from '@/lib/shell/env'
import { Session, type SignupApi, type Writer } from '@/lib/shell/session'
import { meantTheme } from '@/lib/shell/themes'
import type { Line, Location } from '@/lib/shell/types'

/*
 * The small things a guest QA pass found, each one a sentence that answered
 * the wrong question. Fresh fixtures per run: `fixtureEnv()` with no argument
 * shares one mutable set of rooms between every test file.
 */

const text = (lines: Line[]) => lines.map((l) => l.text).join('\n')
const LOBBY: Location = {}
const MUSIC: Location = { room: 'music' }
const IN_POST: Location = { room: 'music', postId: 12 }

function runner() {
  const session = new Session({} as SignupApi, {} as Writer, 'tester')
  return createRunner(fixtureEnv(), ['commons'], session)
}

describe('go says what was actually wrong', () => {
  it('blames the number, not the room, for music/abc', async () => {
    const out = text((await runner()('go music/abc', LOBBY)).lines)
    expect(out).not.toMatch(/no room called/)
    expect(out).toBe('“abc” isn’t a post number — after the slash comes a number. try: go music/12')
  })

  it('names the one place it can take when given two words', async () => {
    const out = text((await runner()('go 14 extra', MUSIC)).lines)
    expect(out).toBe('go takes one place at a time. try: go 14')
  })

  it('says which numbers a room has when the one asked for is not there', async () => {
    // Post numbers are addresses, not counts — music starts at 11.
    const out = text((await runner()('go 1', MUSIC)).lines)
    expect(out).toBe('there’s no post 1 in music. posts here run from 11 to 12. try: go 12')
  })

  it('still opens what is there', async () => {
    const result = await runner()('go music/12', LOBBY)
    expect(result.location).toEqual({ room: 'music', postId: 12 })
  })
})

describe('bare reply inside a post', () => {
  it('suggests reply, not say', async () => {
    const out = text((await runner()('reply', IN_POST)).lines)
    expect(out).toMatch(/^reply what\? try: reply i agree/)
    expect(out).not.toMatch(/say/)
  })
})

describe('theme words people reach for', () => {
  it('takes dark to mean black, not the nearest spelling', async () => {
    const out = text((await runner()('theme dark', LOBBY)).lines)
    expect(out).not.toMatch(/did you mean/)
    expect(out).toMatch(/dark is called black here/)
    expect(out).toMatch(/^black — /m)
  })

  it('knows the other obvious ones', () => {
    expect(meantTheme('white')?.name).toBe('light')
    expect(meantTheme('Night')?.name).toBe('black')
    expect(meantTheme('default')?.name).toBe('warm')
    expect(meantTheme('warm')?.name).toBe('warm')
    expect(meantTheme('purple')).toBeUndefined()
  })

  it('says nothing extra when the name was the name', async () => {
    const out = text((await runner()('theme black', LOBBY)).lines)
    expect(out).not.toMatch(/is called/)
  })
})

describe('rooms is in help', () => {
  for (const at of [LOBBY, { room: 'commons' }, MUSIC, IN_POST]) {
    it(`from ${JSON.stringify(at)}`, async () => {
      const out = text((await runner()('help', at)).lines)
      expect(out).toMatch(/and anywhere:[\s\S]*^rooms — /m)
    })
  }
})

describe('find with nothing to find', () => {
  it('asks what', async () => {
    for (const word of ['find', 'search', 'grep']) {
      expect(text((await runner()(word, LOBBY)).lines), word).toMatch(/^find what\?/)
    }
  })

  it('still searches when the flags say what', async () => {
    const out = text((await runner()('find --by=marisol', LOBBY)).lines)
    expect(out).not.toMatch(/find what/)
    expect(out).toMatch(/marisol/)
  })

  it('still lists everything for posts, which asks for exactly that', async () => {
    expect(text((await runner()('posts', LOBBY)).lines)).toMatch(/music\/12/)
  })

  it('still counts through a pipe', async () => {
    expect(text((await runner()('find | count', LOBBY)).lines)).toMatch(/^\d+ posts$/)
  })
})

describe('a reply in a list says which reply', () => {
  it('in find', async () => {
    const out = text((await runner()('posts', LOBBY)).lines)
    expect(out).toMatch(/\(reply \d+\)/)
    expect(out).not.toMatch(/\(reply\)/)
  })

  it('on a profile', async () => {
    const out = text((await runner()('go ~marisol', LOBBY)).lines)
    expect(out).toMatch(/\(reply \d+\)/)
    expect(out).not.toMatch(/\(reply\)/)
  })
})
