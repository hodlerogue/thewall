import { describe, expect, it } from 'vitest'
import { friendly } from '@/lib/data/writer'

/**
 * Every refusal the schema makes on purpose has to arrive as a sentence.
 *
 * The fall-through is "that didn't send. try again?", which is actively wrong
 * for a deliberate refusal: it says the words were lost and invites the person
 * to do the exact thing that will fail again. So each message the database
 * raises on purpose is checked here, phrased as the error a person sees.
 */

// The messages exactly as the migrations raise them.
const RAISED = {
  verify: 'check your email to keep saying things',
  banned: "you can't say things here anymore: flooding poker",
  bannedBare: "you can't say things here anymore.",
  tooFast: 'too fast — that is a lot of words in a very short time',
  noRoom: 'no room called latenight',
  ephemeral: 'commons does not keep threads',
  blank: 'new row for relation "posts" violates check constraint "posts_body_not_blank"',
  lines: 'new row for relation "posts" violates check constraint "posts_body_line_limit"',
  long: 'new row for relation "posts" violates check constraint "posts_body_length"',
  signedIn: 'you have to be signed in to say something',
  rls: 'new row violates row-level security policy for table "replies"',
}

const FALLBACK = 'that didn’t send. try again?'

describe('what a refusal sounds like', () => {
  it('never falls through to "try again" for something the database meant', () => {
    for (const [name, message] of Object.entries(RAISED)) {
      expect(friendly(message), name).not.toBe(FALLBACK)
    }
  })

  it('keeps the reason somebody was stopped', () => {
    // A ban with no explanation is a wall. ban() carries the reason precisely
    // so the person hears it, and rewriting the message would throw it away.
    expect(friendly(RAISED.banned)).toContain('flooding poker')
    expect(friendly(RAISED.bannedBare)).toContain('anymore')
  })

  it('tells someone posting too fast what to do about it', () => {
    const said = friendly(RAISED.tooFast)
    // §3.7 — name the fix. "Too fast" alone is a report, not a way forward.
    expect(said).toMatch(/minutes|wait|again/)
    expect(said).not.toContain('too fast —')
  })

  it('still names the way out of the §4.7 gate', () => {
    expect(friendly(RAISED.verify)).toContain('resend')
  })

  it('does say "try again" for something that genuinely just failed', () => {
    expect(friendly('could not connect to server')).toBe(FALLBACK)
  })
})
