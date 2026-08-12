import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createChipsFor, createRunner } from '@/lib/commands/run'
import { findCommand } from '@/lib/commands/registry'
import {
  CARD_ALT,
  CARD_BODY,
  CARD_HEADING,
  CTA_PRIMARY,
  DEMO_FOOTNOTE,
  DEMO_SCRIPT,
  HEADLINE,
  PROOFS,
  SUBHEAD,
} from '@/lib/marketing/landing'
import { demoWorld, fixtureSignup, fixtureWriter } from '@/lib/shell/demo'
import { fixtureEnv } from '@/lib/shell/env'
import { Session } from '@/lib/shell/session'
import type { Location } from '@/lib/shell/types'

/**
 * The page that sells this, checked against the thing being sold.
 *
 * Marketing copy is the fastest-rotting text in any codebase: it is written
 * once, read by nobody who works on the product, and describes behaviour that
 * keeps moving. The two things worth pinning are the two that would be
 * embarrassing — naming a command that no longer exists, and a hero that plays
 * a script the site would refuse.
 */

const prose = [
  HEADLINE,
  SUBHEAD,
  CARD_HEADING,
  CARD_BODY,
  CARD_ALT,
  DEMO_FOOTNOTE,
  ...PROOFS.flatMap((proof) => [proof.heading, proof.body]),
].join(' ')

/** The world the hero runs in, built the way `components/Demo.tsx` builds it. */
function demo() {
  const { rooms, people } = demoWorld()
  const env = fixtureEnv(rooms, people)
  let session: Session
  const writer = fixtureWriter(rooms, () => session.name())
  session = new Session(fixtureSignup(people), writer, null)
  const ephemeral = rooms.filter((room) => room.ephemeral).map((room) => room.slug)
  return { env, session, run: createRunner(env, ephemeral, session) }
}

describe('the landing copy', () => {
  it('leads with what it is, in a sentence somebody could repeat', () => {
    expect(HEADLINE).toMatch(/command prompt/)
    // Long enough to say something, short enough to be a headline rather than
    // the first paragraph of one.
    expect(HEADLINE.split(/\s+/).length).toBeLessThan(12)
  })

  it('names only commands that exist', () => {
    const mentioned = new Set(
      [
        ...prose.matchAll(
          /\b(go|say|look|leave|reply|make|find|mail|rename|install|theme|help|what|about|who|resend|login)\b/g,
        ),
      ].map((match) => match[1]),
    )
    for (const verb of mentioned) expect(findCommand(verb), verb).toBeDefined()
  })

  it('shows the interface rather than describing it', () => {
    // Each proof carries a piece of real output. A proof that argued in prose
    // alone would be a feature bullet, which is the thing /about refuses to be
    // and the thing this page is most at risk of becoming.
    expect(PROOFS).toHaveLength(3)
    for (const proof of PROOFS) {
      expect(proof.sample.length, proof.heading).toBeGreaterThan(2)
      expect(proof.sample.some((line) => line.tone === 'echo'), proof.heading).toBe(true)
    }
  })

  it('says out loud that the demo keeps nothing', () => {
    // It is a real prompt on a public page and people type real things into
    // it. The fixture build makes the same promise for the same reason.
    expect(DEMO_FOOTNOTE).toMatch(/not saved|nothing|isn’t kept/i)
    expect(DEMO_FOOTNOTE.toLowerCase()).toContain('saved')
  })

  it('sends people to the prompt, not to a signup', () => {
    expect(CTA_PRIMARY).not.toMatch(/sign ?up|register|join|create an account/i)
  })

  it('describes the picture for somebody who cannot see it', () => {
    expect(CARD_ALT.length).toBeGreaterThan(40)
    expect(CARD_ALT).toMatch(/thewall\.social/)
  })
})

describe('the hero plays a session the site would actually produce', () => {
  it('runs every step through the real registry, and none of it is an error', async () => {
    /*
     * The point of the whole component. A hand-drawn transcript would be free
     * to show a verb that has been renamed, output in a shape the renderer no
     * longer emits, or a room that was deleted from the fixtures — and it would
     * go on looking convincing while being wrong.
     */
    const { run } = demo()
    let at: Location = {}

    for (const command of DEMO_SCRIPT) {
      const result = await run(command, at, { typed: true })
      expect(result.lines.length, `${command} printed nothing`).toBeGreaterThan(0)
      for (const line of result.lines) {
        expect(line.tone, `${command} → ${line.text}`).not.toBe('error')
      }
      if (result.location) at = result.location
    }
  })

  it('ends somewhere with a prompt, not inside a question', async () => {
    /*
     * The constraint that shaped the script.
     *
     * While the session is asking something, the runner treats anything typed
     * as the answer (lib/commands/run.ts) — so a script that ended on `say`
     * would leave a visitor's first tapped command being submitted as their
     * name. The third proof shows that exchange as a picture instead.
     */
    const { run, session } = demo()
    let at: Location = {}
    for (const command of DEMO_SCRIPT) {
      const result = await run(command, at, { typed: true })
      if (result.location) at = result.location
    }
    expect(session.isAsking()).toBe(false)
  })

  it('walks somewhere, so the demonstration is that words move you', async () => {
    const { run } = demo()
    let at: Location = {}
    for (const command of DEMO_SCRIPT) {
      const result = await run(command, at, { typed: true })
      if (result.location) at = result.location
    }
    expect(at.room).toBeDefined()
    expect(at.postId).toBeDefined()
  })

  it('leaves chips to tap wherever it stops', () => {
    // The hand-over is the whole interaction: the script finishes, and what is
    // on screen has to be usable without a keyboard.
    const { rooms } = demoWorld()
    const chipsFor = createChipsFor(rooms.filter((r) => r.ephemeral).map((r) => r.slug))
    expect(chipsFor({ room: 'music', postId: 12 }, null).length).toBeGreaterThan(2)
  })
})

describe('the page', () => {
  const page = readFileSync(join(process.cwd(), 'app/hello/page.tsx'), 'utf8')

  it('does not leave the front door', () => {
    // `/` still redirects into commons. If this page ever becomes the front
    // door that is a decision, not a side effect of editing a route.
    const front = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8')
    expect(front).toMatch(/redirect\(/)
  })

  it('is in the sitemap, since nothing links to it from inside the product', () => {
    const sitemap = readFileSync(join(process.cwd(), 'app/sitemap.ts'), 'utf8')
    expect(sitemap).toContain("at('/hello')")
  })

  it('reserves its own name, so no room can be shadowed by it', async () => {
    const { RESERVED_SLUGS } = await import('@/lib/shell/env')
    expect(RESERVED_SLUGS.get('hello')).toBeDefined()

    const { rooms, people } = demoWorld()
    const made = await fixtureEnv(rooms, people).makeRoom('hello', 'anything at all')
    expect(made.ok).toBe(false)
  })

  it('names the image by the name it is stored under', () => {
    // Two files, deliberately. `public/thewallopengraph.png` is the one this
    // page shows; `app/opengraph-image.png` is the 1200x630 crop Next serves
    // as the share card. Same artwork, different jobs, easy to confuse.
    expect(page).toContain('/thewallopengraph.png')
  })

  it('serves the image with its dimensions, so the page does not jump', () => {
    expect(page).toMatch(/width=\{1600\}/)
    expect(page).toMatch(/height=\{840\}/)
  })
})
