import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createChipsFor, createRunner } from '@/lib/commands/run'
import { findCommand } from '@/lib/commands/registry'
import {
  CARD_ALT,
  CARD_BODY,
  CARD_HEADING,
  CARD_ROOM,
  CTA_PRIMARY,
  DEMO_FOOTNOTE,
  DEMO_QUIET,
  DEMO_REPLIES,
  DEMO_REPLIES_ELSEWHERE,
  DEMO_SCRIPT,
  DEMO_TURNS,
  HEADLINE,
  POSTER_ALT,
  PROOFS,
  SUBHEAD,
} from '@/lib/marketing/landing'
import { answerAs, demoWorld, fixtureSignup, fixtureWriter, newestBy } from '@/lib/shell/demo'
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

  it('has somebody to answer you for every turn it promises', () => {
    // A pool shorter than the turn count would repeat a line inside one demo,
    // which is the exact moment a scripted reply stops passing for one.
    for (const [room, pool] of Object.entries(DEMO_REPLIES)) {
      expect(pool.length, room).toBeGreaterThanOrEqual(DEMO_TURNS)
      expect(new Set(pool).size, `${room} repeats itself`).toBe(pool.length)
    }
    expect(DEMO_REPLIES_ELSEWHERE.length).toBeGreaterThanOrEqual(DEMO_TURNS)
  })

  it('answers without pretending to have read you', () => {
    /*
     * These are written lines, rotated. Nothing reads what you typed and
     * nothing leaves the browser — so nothing in them may claim otherwise, and
     * they have to stay short enough to follow anything.
     *
     * The demo says out loud that the rooms and the people in them are
     * examples, which is what makes an example person answering honest rather
     * than a trick.
     */
    expect(DEMO_FOOTNOTE).toMatch(/example people/i)
    for (const pool of [...Object.values(DEMO_REPLIES), DEMO_REPLIES_ELSEWHERE]) {
      for (const line of pool) {
        expect(line.length, line).toBeLessThan(70)
        // A canned line that echoed your words back would be claiming to have
        // understood them.
        expect(line, line).not.toMatch(/you said|you wrote|you mentioned/i)
      }
    }
  })

  it('says the quiet is the demo rather than the room', () => {
    // Running out of people looks like the site dying if it is not said.
    expect(DEMO_QUIET).toMatch(/demo/i)
  })

  it('sends people to the prompt, not to a signup', () => {
    expect(CTA_PRIMARY).not.toMatch(/sign ?up|register|join|create an account/i)
  })

  it('describes both pictures for somebody who cannot see them', () => {
    expect(CARD_ALT.length).toBeGreaterThan(40)
    expect(POSTER_ALT.length).toBeGreaterThan(40)
  })

  it('does not call the poster a preview, which is what it was doing', () => {
    /*
     * Reported as: "that image was generated by image generation, it's not an
     * accurate depiction of what a link to a room would look like." It was
     * sitting under a heading claiming exactly that.
     *
     * The claim belongs to the cards `lib/brand/og.tsx` generates, so the
     * section shows one of those — live, from the card route — and the poster
     * moved to the end where it asserts nothing. This holds the two apart: the
     * poster's own description may not call itself a screenshot or a preview.
     */
    expect(POSTER_ALT).toMatch(/illustrat/i)
    expect(POSTER_ALT).not.toMatch(/screenshot|preview|share card/i)
    expect(CARD_BODY).toMatch(/not a mock-?up/i)
  })

  it('draws the link claim from a room that is really there', async () => {
    const { rooms, people } = demoWorld()
    const room = await fixtureEnv(rooms, people).getRoom(CARD_ROOM)
    expect(room, `${CARD_ROOM} is named on the landing page`).toBeDefined()
    // Empty would draw a card saying so, under a heading about proof of life.
    expect(room!.posts.length).toBeGreaterThan(0)
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

  it('lets somebody else say something, which is the whole point of a room', async () => {
    /*
     * The demo's last act used to be your own sentence landing in silence.
     * `answerAs` is the write that fixes it — the same world the fixture writer
     * writes to, with the name supplied rather than looked up.
     */
    const { rooms, people } = demoWorld()
    const env = fixtureEnv(rooms, people)

    const landed = answerAs(rooms, 'music', 'marisol', 'a written line', 12)
    expect(landed).toEqual({ depth: 1, address: 12 })

    const room = await env.getRoom('music')
    const post = room!.posts.find((p) => p.id === 12)
    expect(post!.replies.at(-1)).toMatchObject({ author: 'marisol', body: 'a written line' })
  })

  it('posts rather than replies in commons, which refuses replies', async () => {
    // §3.10 — no permanent addresses, and the schema's trigger refuses a reply
    // there. A fixture that allowed one would teach the demo a shape the site
    // would turn down.
    const { rooms, people } = demoWorld()
    const landed = answerAs(rooms, 'commons', 'tuck', 'ha, same', 2)

    expect(landed?.depth).toBe(0)
    expect(landed?.address).toBeUndefined()
    const room = await fixtureEnv(rooms, people).getRoom('commons')
    expect(room!.posts[0]).toMatchObject({ author: 'tuck', body: 'ha, same' })
  })

  it('finds the newest thing you said, which is how it knows to answer', () => {
    const { rooms } = demoWorld()
    expect(newestBy(rooms, 'music', 'nobody')).toBeUndefined()

    answerAs(rooms, 'music', 'ryan', 'mine, as a post')
    expect(newestBy(rooms, 'music', 'ryan')?.body).toBe('mine, as a post')

    /*
     * A reply counts as much as a post, and this is the case that made the
     * first version wrong: it walked the posts, which come newest-first, and
     * took the first one of yours it found — so answering somebody on an old
     * post left the newest thing you had said buried under it while a post from
     * an hour ago won. By time, the reply is what you just wrote.
     *
     * Stamped a minute on rather than written back-to-back, because two writes
     * in the same millisecond is a tie no clock can break, and is unreachable
     * from a prompt that runs one command at a time.
     */
    answerAs(rooms, 'music', 'ryan', 'mine, as a reply', 12)
    const reply = rooms
      .find((room) => room.slug === 'music')!
      .posts.find((post) => post.id === 12)!
      .replies.at(-1)!
    reply.createdAt = new Date(reply.createdAt.getTime() + 60_000)

    expect(newestBy(rooms, 'music', 'ryan')?.body).toBe('mine, as a reply')
    // And the thread to answer in is the post it sits under, not the reply.
    expect(newestBy(rooms, 'music', 'ryan')?.postId).toBe(12)
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

  it('shows a card the site drew, not a picture of one', () => {
    // The section's whole claim is that a link previews as the conversation.
    // The only picture that can carry it is one the card route made.
    expect(page).toContain('/opengraph-image`}')
    expect(page).toContain('landing-poster')
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

  it('has the picture at the size it says, and the master it was cut from', () => {
    /*
     * Three copies of one artwork, each with a job: the master in `assets/`
     * that is served to nobody, the 1200×630 crop Next attaches as the share
     * card, and the 1600×840 the page shows. The dimensions in the markup are
     * what stop the page reflowing when it lands, so they are read out of the
     * file rather than trusted — a re-export at another size would otherwise
     * leave the page reserving the wrong hole for it.
     */
    const size = (path: string) => {
      const png = readFileSync(join(process.cwd(), path))
      return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
    }

    expect(size('public/thewallopengraph.png')).toEqual({ width: 1600, height: 840 })
    expect(size('app/opengraph-image.png')).toEqual({ width: 1200, height: 630 })
    expect(size('assets/thewallopengraph.png').width).toBeGreaterThan(1600)
  })
})
