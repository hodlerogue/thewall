import { describe, expect, it } from 'vitest'
import { echoOf } from '@/lib/commands/run'
import { COMMANDS } from '@/lib/commands/registry'

/**
 * Which half of what you typed recedes.
 *
 * Every command echo is dimmed so the answer stands out, and that is right for
 * the verbs whose argument is an instruction: type `go music` and the answer is
 * the point, so the instruction should get out of the way.
 *
 * `say` and `reply` are the two where the argument is not an instruction but
 * the product. Dimming them the same way rendered somebody's own sentence at
 * 9.1:1 against the ground while the same words, read back in the room a moment
 * later, were 14.0:1 — the interface using its brightness hierarchy to rank a
 * contribution below the reading of it. Reported exactly that way: "from your
 * view it doesn't look like a typical sent message... the font isn't white."
 */

describe('a contribution keeps its words', () => {
  it('splits the prompt and verb off, and leaves the sentence', () => {
    const line = echoOf('say good to be here', 'ryan:poker$')

    // The prompt and the verb, which the shell contributed.
    expect(line.prefix).toBe('ryan:poker$ say ')
    // And the part a person wrote, which is not in the prefix and so does not
    // take the prefix's colour.
    expect(line.text).toBe('good to be here')
  })

  it('does the same for a reply', () => {
    const line = echoOf('reply that is not about the film', 'ryan:music/12$')
    expect(line.prefix).toBe('ryan:music/12$ reply ')
    expect(line.text).toBe('that is not about the film')
  })

  it('reads back as the line that was typed, in order, once', () => {
    /*
     * One line, nothing repeated, nothing reordered. Splitting a contribution
     * onto two lines would make this a chat client rather than a terminal, and
     * printing the words again underneath would show them twice — which was a
     * separate complaint, about a separate bug, and is not worth trading for.
     */
    const line = echoOf('say good to be here', 'ryan:poker$')
    expect(`${line.prefix ?? ''}${line.text}`).toBe('ryan:poker$ say good to be here')
  })

  it('echoes the alias somebody typed, not the verb it resolves to', () => {
    // The echo is a record of what happened, not a correction of it. `post` is
    // an alias of `say`; somebody who typed it should see it.
    const line = echoOf('post something', 'ryan:poker$')
    expect(line.prefix).toBe('ryan:poker$ post ')
    expect(line.text).toBe('something')
  })
})

describe('everything else recedes whole', () => {
  it('dims an ordinary command, argument and all', () => {
    const line = echoOf('go music', 'ryan:lobby$')
    expect(line.prefix).toBeUndefined()
    expect(line.text).toBe('ryan:lobby$ go music')
  })

  it('dims a bare verb', () => {
    const line = echoOf('look', 'ryan:poker$')
    expect(line.prefix).toBeUndefined()
    expect(line.text).toBe('ryan:poker$ look')
  })

  it('dims `say` with nothing after it, because there is no sentence yet', () => {
    // `say` alone is an error, and what it produced is the interesting part.
    const line = echoOf('say', 'ryan:poker$')
    expect(line.prefix).toBeUndefined()
    expect(line.text).toBe('ryan:poker$ say')
  })

  it('dims something that is not a command at all', () => {
    const line = echoOf('gooo music', 'ryan:lobby$')
    expect(line.prefix).toBeUndefined()
    expect(line.text).toBe('ryan:lobby$ gooo music')
  })

  it('dims an answer typed during signup, which is not a command', () => {
    // Mid-question everything typed is an answer. An address is not content and
    // must not be lit up like one.
    const line = echoOf('ryan@example.org', 'guest:commons$')
    expect(line.prefix).toBeUndefined()
  })

  it('keeps the whole echo on one line either way', () => {
    for (const input of ['look', 'go music', 'say hello', 'reply yes', 'nonsense here']) {
      const line = echoOf(input, 'ryan:poker$')
      expect(`${line.prefix ?? ''}${line.text}`, input).toBe(`ryan:poker$ ${input}`)
    }
  })
})

describe('which verbs claim to carry content', () => {
  it('is exactly the two that write something down', () => {
    /*
     * Asserted as a set by name, not a count. `contributes` lights a line up at
     * full brightness, so a verb acquiring it by accident would give an
     * instruction the visual weight of a sentence — and a count would go on
     * passing while the membership changed.
     */
    const carrying = COMMANDS.filter((c) => c.contributes).map((c) => c.verb).sort()
    expect(carrying).toEqual(['reply', 'say'])
  })
})

describe('a reply’s aim is not part of what was said', () => {
  it('puts the number in the quiet half, with the verb', () => {
    /*
     * `reply 2 you are right` — the `2` is an address. It is a thing the person
     * typed but not a thing they said, and the bright half of this line is for
     * what they said. Left in the sentence it reads as the first word of the
     * reply, which is what somebody scanning the thread later has to un-read.
     */
    const line = echoOf('reply 2 you are right about that', 'ryan:music/12$')
    expect(line.prefix).toBe('ryan:music/12$ reply 2 ')
    expect(line.text).toBe('you are right about that')
  })

  it('leaves a number alone when it is the sentence', () => {
    // `reply 2` with nothing after it is somebody who has not finished typing,
    // and the handler posts it as the word "2" — so the echo must not pretend
    // it was an address.
    const line = echoOf('reply 2', 'ryan:music/12$')
    expect(line.prefix).toBe('ryan:music/12$ reply ')
    expect(line.text).toBe('2')
  })

  it('leaves say alone entirely', () => {
    // `say 2 things happened` posts "2 things happened". `say` is content and
    // nothing else; only `reply` takes an aim.
    const line = echoOf('say 2 things happened today', 'ryan:music$')
    expect(line.prefix).toBe('ryan:music$ say ')
    expect(line.text).toBe('2 things happened today')
  })

  it('still reads back as exactly what was typed', () => {
    const line = echoOf('reply 2 you are right', 'ryan:music/12$')
    expect(`${line.prefix ?? ''}${line.text}`).toBe('ryan:music/12$ reply 2 you are right')
  })
})
