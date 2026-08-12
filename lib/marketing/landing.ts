import type { Line } from '@/lib/shell/types'

/**
 * The one page on this site that is allowed to sell it.
 *
 * `lib/guide/about.ts` opens by saying it is written with "no marketing, no
 * feature bullets, and no claim that is not true of the code", and that is the
 * right register for the rundown — somebody reading it has already arrived and
 * wants to understand what they found. It is the wrong register for a link
 * pasted into a group chat, which has about four seconds.
 *
 * So this is the other voice, kept honest by the same means: the copy lives in
 * one module so `landing.test.ts` can check every command it names against
 * `COMMANDS`, and `spelling.test.ts` can check every word. The half that would
 * rot fastest — the demo — is not copy at all. It is a list of commands run
 * through the real registry, so a renamed verb breaks the build rather than the
 * hero.
 */

export const WORDMARK = 'thewall.social'

/** What it is, in the words somebody would use to describe it to a friend. */
export const HEADLINE = 'A social network that is a command prompt.'

export const SUBHEAD =
  'You type where you want to go, and it takes you there. Rooms full of people talking, and nothing in between you and them — no algorithm, no likes, no feed deciding what you see next.'

export interface Proof {
  heading: string
  body: string
  /** A piece of the real interface, drawn in the real tones. */
  sample: readonly Line[]
}

/**
 * Three, each shown rather than asserted.
 *
 * Every sample below is output this site actually produces, in the tones it
 * produces it in — the same `Line` shape the shell renders and the share cards
 * are drawn from. A landing page that mocked up its own screenshots would be
 * free to be prettier than the product, which is the oldest lie in software.
 */
export const PROOFS: readonly Proof[] = [
  {
    heading: 'You always know where you are',
    body: 'The text in front of your cursor is your name, the room, and what you are reading. Nothing else on the screen has to spend itself saying that, which is most of why this fits on a phone.',
    sample: [
      { text: 'jameson:music/12$ look', tone: 'echo' },
      { text: '' },
      { text: 'music/12  jameson, 2h ago', tone: 'dim' },
      { text: 'found my dad’s records in the garage.', depth: 1 },
      { text: '2 replies — go 12', tone: 'faint', depth: 1 },
    ],
  },
  {
    heading: 'Rooms, not a feed',
    body: 'Walk into one, read what people said, say something back. A room has a last post and you can reach it — nothing here scrolls forever, and nothing decides the order for you but time.',
    sample: [
      { text: 'guest:lobby$ go kitchen', tone: 'echo' },
      { text: '' },
      { text: 'kitchen', tone: 'accent' },
      { text: 'what you cooked', tone: 'faint', depth: 1 },
    ],
  },
  {
    heading: 'Reading asks nothing of you',
    body: 'No account to look around, and no wall in front of the good part. The first time you say something you are asked what to call you, and that is the whole of signing up.',
    sample: [
      { text: 'guest:kitchen$ say the trick is roasting them all at once', tone: 'echo' },
      { text: '' },
      { text: 'what should i call you?', tone: 'accent' },
      { text: 'your sentence is held — you will not type it twice.', tone: 'faint' },
    ],
  },
]

/**
 * Links, and the picture that is allowed to make the claim.
 *
 * This section showed the poster and said "this is the preview", which was
 * wrong twice over: the poster is drawn art rather than a screenshot, and the
 * claim it was attached to is specifically about the cards the site *generates*
 * — which are a different thing, made by `lib/brand/og.tsx` out of the same
 * `renderRoom` the screen uses.
 *
 * So the picture here is now a real one, fetched live from the card route for a
 * real room. It cannot flatter the product because the product drew it, and it
 * cannot go stale because it is made when it is asked for.
 */
export const CARD_HEADING = 'Links look like the thing they point at'
export const CARD_BODY =
  'Send somebody a room, or one conversation inside it, and the preview is that conversation — drawn by the site out of the same lines you would have read on the screen. The picture below is not a mock-up of one. It is the live card for the music room, made when this page loaded.'

/** The room the live card is drawn from. Seeded, curated, and never empty. */
export const CARD_ROOM = 'music'
export const CARD_ALT = `The share card for the ${CARD_ROOM} room: a terminal window showing what people have been saying in it.`

/**
 * The poster, and the one thing it is honest to say about it.
 *
 * Drawn rather than captured — the rooms and commands in it are real, the
 * layout is an illustrator's, and it is the site's own share card. That makes
 * it brand art, and brand art has to sit somewhere it is not claiming to be a
 * screenshot. Here, at the end, with nothing asserted about it.
 */
export const POSTER_ALT =
  'thewall.social, illustrated: a terminal window listing rooms and the commands look, go, who and theme, beside the words "social network, but in command prompt".'

export const CTA_PRIMARY = 'open the prompt'
export const CTA_SECONDARY = 'read the rundown'

/** Under the demo, once it has played itself out. */
export const DEMO_INVITATION = 'your turn — tap a command, then press enter'
export const DEMO_FOOTNOTE =
  'A real one, running on example rooms. Nothing you type here is saved or sent anywhere.'

/**
 * What the hero plays on arrival.
 *
 * Run through the real runner against the fixture rooms, so this cannot show
 * anything the site would not. Three beats and no more: the lobby is already on
 * screen when the page loads, so this is walking in, opening a conversation,
 * and finding out somebody is there.
 *
 * **Nothing here may start the signup.** `say` as a guest hands the session a
 * question, and while it is asking, the runner treats anything typed as the
 * answer (`lib/commands/run.ts:109`) — so a visitor taking over would find
 * their first tapped command being submitted as a name. The third proof above
 * shows that exchange instead, where it is a picture and cannot be typed into.
 */
export const DEMO_SCRIPT: readonly string[] = ['go music', 'go 12', 'who']
