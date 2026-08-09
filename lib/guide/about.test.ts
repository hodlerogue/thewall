import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ABOUT, ABOUT_SUMMARY } from '@/lib/guide/about'
import { COMMANDS, findCommand } from '@/lib/commands/registry'
import { ROOM_PAGE } from '@/lib/shell/env'
import { MADE_SLOTS } from '@/lib/shell/render'
import { Session } from '@/lib/shell/session'

/**
 * The rundown, checked for the two ways a page like this goes wrong.
 *
 * `CHANGING-IT.md` argues against a user manual because a hand-written command
 * list drifts away from the registry, leaving two answers to the same question
 * with one of them wrong. That argument is answered rather than overruled: the
 * page generates its list from `COMMANDS`, and these assert that the prose does
 * not quietly grow a second copy of it.
 *
 * The other way is describing a product that does not exist — claims about how
 * something works that were true when written and are not now.
 */

const prose = ABOUT.flatMap((section) => section.body).join('\n')

/** Every migration, in the order applying them would. */
const schema = (() => {
  const dir = join(__dirname, '..', '..', 'supabase', 'migrations')
  return readdirSync(dir)
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
})()

describe('every number in the prose comes from somewhere', () => {
  /*
   * Written after checking these by hand for the third time.
   *
   * A page that describes the product is only worth having while it is true,
   * and the parts that rot first are the numbers: a page size, a limit, a rate,
   * a decay window. Each one lives in exactly one place — a constant or a
   * migration — and this reads that place rather than restating it, so raising
   * a cap fails here instead of leaving a sentence that quietly lies.
   *
   * Each assertion checks it found its source first. A regex that stops
   * matching would otherwise turn into a test that passes by comparing nothing.
   */
  it('a room shows a page, and older walks back by the same page', () => {
    expect(prose).toContain('newest sixty posts')
    expect(prose).toContain('walks back sixty at a time')
    expect(ROOM_PAGE).toBe(60)
  })

  it('a post is as long as the database lets it be', () => {
    const declared = [
      ...schema.matchAll(/posts_body_length\s+check \(char_length\(body\) between 1 and (\d+)\)/g),
    ]
    expect(declared.length, 'the constraint is not in the migrations any more').toBeGreaterThan(0)

    const limit = Number(declared[declared.length - 1][1])
    expect(limit).toBe(Session.LIMIT)
    expect(prose).toContain(`up to ${limit.toLocaleString('en-US')} characters`)
  })

  it('rooms can be made at the rate the function enforces', () => {
    const rate = /if v_made >= (\d+) then/.exec(schema)?.[1]
    const window = /and created_at > now\(\) - interval '(\d+) days';/.exec(schema)?.[1]
    expect(rate, 'the rate limit moved').toBe('3')
    expect(window, 'the window moved').toBe('7')
    expect(prose).toContain('three in any seven days')
  })

  it('and drop out of the lobby after the window the view fades them on', () => {
    // Two weeks, in `room_overview` — not the seven-day `archive_quiet_rooms`,
    // which is a lever an operator pulls by hand and is not what anybody sees.
    const fade = /coalesce\(own\.created_at, r\.created_at\) > now\(\) - interval '(\d+) days'/.exec(
      schema,
    )?.[1]
    expect(fade, 'the lobby no longer fades quiet rooms').toBe('14')
    expect(prose).toContain('a fortnight of silence')
  })

  it('commons keeps things for exactly as long as it says', () => {
    const window = /interval '(\d+) hours'/.exec(schema)?.[1]
    expect(window, 'the commons expiry moved').toBe('24')
    expect(prose).toContain('gone in 24 hours')
  })

  it('and the lobby shows a selection, which the prose no longer calls the list', () => {
    /*
     * It said "the lobby is the list of rooms", which stopped being true when
     * §4.2 was reopened and anybody could make one: what it shows is every
     * curated room, the liveliest handful of the rest, and a count.
     */
    expect(MADE_SLOTS).toBeGreaterThan(0)
    expect(prose).not.toContain('the list of rooms')
    expect(prose).toContain('how many more there are')
  })
})

describe('the rundown', () => {
  it('says what the place is before it says how to use it', () => {
    // Somebody who has just found a command prompt on a social site has one
    // question, and it is not which verbs there are.
    expect(ABOUT[0].heading).toBe('What this is')
    expect(ABOUT[0].body.join(' ')).toMatch(/command prompt/)
  })

  it('names every command it mentions, and only ones that exist', () => {
    // The failure this catches is prose that outlives a rename: a paragraph
    // telling somebody to type a verb the registry no longer has.
    const mentioned = new Set(
      [...prose.matchAll(/\b(go|say|look|leave|reply|make|find|mail|rename|install|theme|help|what|about|who|resend|login|terms|privacy) /g)].map(
        (m) => m[1],
      ),
    )
    expect(mentioned.size).toBeGreaterThan(8)
    for (const verb of mentioned) {
      expect(findCommand(verb), verb).toBeDefined()
    }
  })

  it('does not hand-write the list of commands, which is what would rot', () => {
    /*
     * The whole objection to a user manual, and the reason this one is allowed
     * to exist. The page renders its glossary from COMMANDS; if the prose ever
     * grows its own copy, there are two answers to one question and only one
     * gets updated.
     */
    for (const section of ABOUT) {
      const looksLikeAList = section.body.filter((line) => /^[a-z]+ — /.test(line)).length
      expect(looksLikeAList, section.heading).toBe(0)
    }
  })

  it('tells somebody on a new phone how to get back in', () => {
    /*
     * The one question this page did not answer, and the most expensive one to
     * leave unanswered: somebody who cannot find the way back makes a second
     * account under a second name, and the first one's history is gone for
     * good. The verb has to appear, and it has to appear with a reason to use
     * it that somebody would recognise as their situation.
     */
    expect(prose).toMatch(/\blogin\b/)
    expect(prose).toMatch(/new phone|clearing your browser/i)
  })

  it('does not say which way a list runs, now that it runs the other way', () => {
    // "newest first" was written in two places and became false when the
    // scrollback's snap-to-bottom argument won. A doc describing the opposite
    // of what the screen does is worse than one that does not mention it.
    expect(prose).not.toMatch(/newest first/i)
  })

  it('does not promise anything the product does not do', () => {
    // Each of these is a thing this deliberately has not got, and each is a
    // thing a page like this drifts into claiming.
    for (const absent of ['notification', 'push', 'follower', 'algorithm']) {
      const claimed = new RegExp(`\\b(we|you) (can|get|have) [^.]*${absent}`, 'i')
      expect(prose, absent).not.toMatch(claimed)
    }
  })

  it('says out loud what it does not have, which is most of the point', () => {
    const negatives = ABOUT.find((s) => s.heading.includes('does not have'))!
    const text = negatives.body.join(' ').toLowerCase()
    for (const thing of ['algorithm', 'likes', 'advertising', 'trackers', 'infinite scroll']) {
      expect(text, thing).toContain(thing)
    }
  })

  it('covers the two ways to answer something, and the tap', () => {
    /*
     * Three things shipped in a fortnight that nothing user-facing mentioned:
     * answering a post without opening it, answering one from another room by
     * its address, and the fact that every address on the screen is a button.
     *
     * The last is the one that most needs saying. It is discoverable only by
     * noticing that the number is orange and guessing what that means — and
     * "orange is a thing you can type" is a convention this site has never
     * written down anywhere.
     */
    expect(prose).toContain('reply 5')
    expect(prose).toContain('reply music/12')
    expect(prose).toMatch(/number on screen is a button/)
    // The contract itself — types rather than runs — is stated once, under
    // "On a phone", and covers the chips and the numbers together.
    expect(prose).toMatch(/tapping one puts the word in rather than running it/)
  })

  it('is short enough to read in one sitting', () => {
    const words = prose.split(/\s+/).length
    /*
     * A rundown, not a manual. Past about this nobody finishes it, and the
     * parts that matter are at the end.
     *
     * Raised once, from 1100, and worth writing down rather than doing
     * quietly: the page now explains `login`, `older`, the feed and `notify`,
     * none of which existed when 1100 was picked, and the four rounds of
     * shaving sentences to get back under it were tightening prose to protect a
     * number rather than protecting the reader. 1200 words is about five
     * minutes, which is what "one sitting" was always standing for.
     *
     * It does not move again. The next thing worth explaining should displace
     * something here, not extend it — that is the constraint doing its job, and
     * this note exists so the next person to hit it raises the limit only if
     * they can make the same argument.
     */
    expect(words).toBeLessThan(1200)
    expect(words).toBeGreaterThan(400)
  })
})

describe('the short version, for the prompt', () => {
  it('fits in a scrollback rather than filling it', () => {
    expect(ABOUT_SUMMARY.length).toBeLessThanOrEqual(8)
  })

  it('names where the whole thing is', () => {
    // A summary that does not say where the rest lives is a dead end.
    expect(ABOUT_SUMMARY.join('\n')).toContain('/about')
  })

  it('leads with what it is, not with what to type', () => {
    expect(ABOUT_SUMMARY[0]).toMatch(/social site/)
  })
})

describe('about, the command', () => {
  it('exists, is not hidden, and answers to what somebody lost would type', () => {
    const about = COMMANDS.find((c) => c.verb === 'about')!
    expect(about.hidden).toBeFalsy()
    for (const word of ['about', 'guide', 'intro', 'wtf', 'readme']) {
      expect(findCommand(word)?.verb, word).toBe('about')
    }
  })

  it('works from everywhere, because being lost is not context-sensitive', () => {
    const about = COMMANDS.find((c) => c.verb === 'about')!
    for (const context of ['lobby', 'room', 'commons', 'post', 'person'] as const) {
      expect(about.contexts, context).toContain(context)
    }
  })
})


describe('the page publishes nothing §4.8 asked to keep quiet', () => {
  it('shows the gloss rather than the full detail, so the pipe stays unadvertised', async () => {
    /*
     * §4.8: the pipe is "documented only inside `what posts`, discoverable by
     * the curious. Don't advertise it." `find`'s detail carries the example
     * that does exactly that — which is right there and wrong on a page headed
     * "everything you can type".
     *
     * So the page renders glosses. This asserts the difference is real rather
     * than incidental: if a gloss ever grows the example, this fails.
     */
    const find = COMMANDS.find((c) => c.verb === 'find')!
    expect(find.detail('room'), 'the pipe should still be in what find').toContain('| count')
    expect(find.gloss('room'), 'and never in the gloss').not.toContain('|')

    for (const command of COMMANDS) {
      expect(command.gloss('room'), command.verb).not.toContain('|')
    }
  })

  it('never lists a hidden command', () => {
    // `doctor` and the pipe's own machinery are found by curiosity or by being
    // told, which is the point of them.
    const hidden = COMMANDS.filter((c) => c.hidden).map((c) => c.verb)
    expect(hidden.length).toBeGreaterThan(0)
    for (const verb of hidden) {
      expect(prose, verb).not.toMatch(new RegExp(`\\b${verb}\\b`))
    }
  })
})
