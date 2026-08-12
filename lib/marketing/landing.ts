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

/**
 * What it is, in the words somebody would use to describe it to a friend.
 *
 * Short because the demo is directly underneath it. A headline competing with a
 * working copy of the product loses, so this stops at the hook and lets the
 * thing itself do the explaining — which is also why the subhead is one line
 * now instead of forty words restating this one.
 */
export const HEADLINE = 'A social network you type.'

export const SUBHEAD =
  'No feed, no likes, no algorithm. Rooms full of people, and a prompt that walks you into them.'

/**
 * What a search result says, which is not what the headline says.
 *
 * The headline can afford to be short because the demo is under it. A search
 * result has no demo under it and about 155 characters, so it spends them on
 * the words somebody would actually type into a search box — "command prompt"
 * among them, which the headline no longer contains.
 */
export const DESCRIPTION =
  'A social site where the whole interface is a command prompt. Rooms, posts and replies, navigated by typing — no feed, no likes, no algorithm.'

/**
 * The one place the page raises its voice.
 *
 * A page with no scale contrast reads as a list: every section the same size,
 * so nothing is emphasised and the eye has nowhere to land. This is the
 * sentence worth stopping on, and it is lifted from `lib/guide/about.ts`
 * unchanged — it is the best sentence in the codebase and it is the argument
 * every other line here is in service of.
 */
export const STATEMENT =
  'Everything here is written by a person, to be read by a person. That is the whole product.'

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
    body: 'The text in front of your cursor is your name, the room, and what you are reading. Nothing else on the screen has to say it.',
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
    body: 'Walk in, read what people said, say something back. A room has a last post and you can reach it. Nothing here scrolls forever.',
    sample: [
      { text: 'guest:lobby$ go kitchen', tone: 'echo' },
      { text: '' },
      { text: 'kitchen', tone: 'accent' },
      { text: 'what you cooked', tone: 'faint', depth: 1 },
    ],
  },
  {
    heading: 'Reading asks nothing of you',
    body: 'No account to look around. The first time you say something you are asked what to call you, and that is the whole of signing up.',
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

/** The last thing said, above the last way in. */
export const CLOSING = 'There is a prompt waiting, and people behind it.'

/** Under the demo, once it has played itself out. */
export const DEMO_INVITATION = 'your turn — tap a command, then press enter'
export const DEMO_FOOTNOTE =
  'A real one, running on example rooms with example people in them. Nothing you type here is saved or sent anywhere.'

/**
 * Somebody answering you in the demo, and the honest limits of it.
 *
 * Once you have said something under a name, the demo answers a beat later, the
 * way the real site does when somebody else is standing in the room. Without it
 * the demo's last act is your own sentence landing in silence, which is the
 * opposite of what a social site has to demonstrate.
 *
 * **Written, not generated.** These are lines chosen for the room and rotated
 * through; nothing is sent anywhere and nothing reads what you typed. That is
 * the whole reason they are short and non-committal — an answer that pretended
 * to have understood you would be a lie about the one thing this page is
 * selling, which is that everything here is written by a person to be read by a
 * person. The footnote under the demo says the rooms and the people in them are
 * examples, so an example person answering is the same claim, kept.
 */
export const DEMO_TURNS = 5

/**
 * Per room, because a room is a subject and a reply that ignores it is worse
 * than none. Rotated in order rather than at random, so the demo is the same
 * demo twice — the thing a screenshot in a bug report depends on.
 */
export const DEMO_REPLIES: Record<string, readonly string[]> = {
  music: [
    'this is the correct opinion and i will not be taking questions',
    'ok but what are we listening to while we agree about this',
    'adding it to the pile, thank you',
    'i had this argument with my brother for a year',
    'right, and nobody ever believes it until they hear it',
  ],
  kitchen: [
    'writing this down, genuinely',
    'the trick is always more salt than you think',
    'i have failed at this twice, so i am invested',
    'this is the kind of thing i come here for',
    'making it this week, will report back',
  ],
  builders: [
    'post a picture when it stops being embarrassing',
    'the leftover bolt is a rite of passage',
    'how long did that take you, honestly',
    'this is very much my kind of nonsense',
    'stealing this approach wholesale',
  ],
  commons: [
    'ha, same',
    'this is the correct energy for a tuesday',
    'strongly agree and i am not sure why',
    'well now i want to know more',
    'you are among friends',
  ],
}

/** Anywhere without its own set. Deliberately the flattest of them. */
export const DEMO_REPLIES_ELSEWHERE: readonly string[] = DEMO_REPLIES.commons

/** Said once, when the demo has run out of people. */
export const DEMO_QUIET =
  'the room has gone quiet — that is the demo, not the site. open the prompt for the real one.'

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
