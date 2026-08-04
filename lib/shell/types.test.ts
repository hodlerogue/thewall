import { describe, expect, it } from 'vitest'
import {
  contextOf,
  locationToPath,
  pathToLocation,
  promptLabel,
  type Location,
} from '@/lib/shell/types'

/**
 * §3.4 — "the prompt path and the URL are the same value". That is only true
 * if it round-trips, and a profile is the first location shape where the two
 * halves could plausibly disagree.
 */

const EPHEMERAL = ['commons']

describe('where you are', () => {
  it('names the context from the location alone', () => {
    expect(contextOf({}, EPHEMERAL)).toBe('lobby')
    expect(contextOf({ room: 'music' }, EPHEMERAL)).toBe('room')
    expect(contextOf({ room: 'commons' }, EPHEMERAL)).toBe('commons')
    expect(contextOf({ room: 'music', postId: 12 }, EPHEMERAL)).toBe('post')
    expect(contextOf({ person: 'marisol' }, EPHEMERAL)).toBe('person')
  })

  it('shows a person as a tilde, so the prompt never reads like a room', () => {
    expect(promptLabel(null, { person: 'marisol' })).toBe('guest:~marisol$')
    expect(promptLabel('jameson', { person: 'marisol' })).toBe('jameson:~marisol$')
    // The distinction has to survive into the prompt: a room called marisol
    // and the person marisol are different places to be standing.
    expect(promptLabel('jameson', { room: 'marisol' })).toBe('jameson:marisol$')
  })
})

describe('the path and the prompt are one value', () => {
  const shapes: Location[] = [
    {},
    { room: 'music' },
    { room: 'commons' },
    { room: 'music', postId: 12 },
    { person: 'marisol' },
  ]

  it('round-trips every location shape through its url', () => {
    for (const location of shapes) {
      expect(pathToLocation(locationToPath(location))).toEqual(location)
    }
  })

  it('gives a person their own address', () => {
    expect(locationToPath({ person: 'marisol' })).toBe('/~marisol')
    expect(pathToLocation('/~marisol')).toEqual({ person: 'marisol' })
  })

  it('leaves you somewhere real when the url names nobody', () => {
    // `/~` would otherwise ask for a profile called "" and report that they
    // do not exist, which is true but useless.
    expect(pathToLocation('/~')).toEqual({})
  })

  it('does not confuse a room with a person of the same name', () => {
    expect(pathToLocation('/marisol')).toEqual({ room: 'marisol' })
    expect(pathToLocation('/~marisol')).toEqual({ person: 'marisol' })
  })
})
