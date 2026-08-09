/**
 * What this place is, for somebody who has just arrived at it.
 *
 * `CHANGING-IT.md` argues there should be no user manual, on the grounds that
 * `help` and `what <command>` are generated from the registry and a hand-written
 * command list would drift away from them. That argument is right about a
 * *reference* and wrong about everything else: it answers "what can I type" and
 * has nothing to say to somebody looking at a command prompt on a social site
 * and wondering what on earth they have found.
 *
 * So this is the other half — what the place is, why it is shaped like this,
 * and how the pieces fit — and the one part that would rot, the list of verbs,
 * is generated from `COMMANDS` at render time rather than written out here. The
 * rot argument is answered rather than argued with.
 *
 * Written to be read straight through in a few minutes, in the site's voice: no
 * marketing, no feature bullets, and no claim that is not true of the code.
 */

export interface GuideSection {
  heading: string
  body: readonly string[]
}

/** The short version, for the `about` command. Long enough to be honest. */
export const ABOUT_SUMMARY: readonly string[] = [
  'thewall is a social site with no feed, no likes and no algorithm. the whole interface is this prompt.',
  'there are rooms. you walk into one, read what is there, and say something.',
  'reading needs no account. the first time you say something, you are asked for a name.',
  '',
  'type help for what you can type from here, or what <command> for any of it.',
  'the whole rundown is at thewall.social/about.',
]

export const ABOUT: readonly GuideSection[] = [
  {
    heading: 'What this is',
    body: [
      'thewall.social is a social site where the entire interface is a command prompt. You type words, and it does things. No algorithm deciding what you see next, no like button, no follower count.',
      'It is one place made of rooms: you walk into one, read what people said there, and say something back.',
      'Everything here is written by a person, to be read by a person. That is the whole product.',
    ],
  },
  {
    heading: 'Why a prompt',
    body: [
      'Because it answers "where am I" without being asked. The text before your cursor — jameson:music/12$ — is your name, the room, and what you are reading. Nothing else on the screen is spent saying that.',
      'Because it cannot scroll forever. A room shows its newest sixty posts; older walks back sixty at a time until you reach the first thing anybody said there. It ends, and you can get to the end.',
      'And because it teaches itself: help lists everything you can type from where you are standing, and what <command> explains any of it. If you have never opened a terminal, you do not need to have.',
    ],
  },
  {
    heading: 'Where you are',
    body: [
      'The lobby is the list of rooms. Type look to see it, then go roomname to walk into one — go music.',
      'A room holds posts. look shows them, each with a permanent number in front, never reused. go 12 opens it and puts you inside the conversation. leave backs you out one step.',
      'The path in the prompt is also the web address: if it says music/12, then thewall.social/music/12 is that post, and a link you can send somebody.',
    ],
  },
  {
    heading: 'Saying something',
    body: [
      'say, and then what you want to say. In a room that starts a new post; inside a post it adds a reply. Replies are numbered too: reply 2 answers reply 2, where it was written.',
      'You do not need an account to read. The first time you try to say something, you are asked what to call you and where to send a sign-in link — and the sentence you already typed is posted for you. You never type it twice.',
      'There are no passwords, and your address is never shown to anybody or sold. You can say one thing before you check that email — after that it asks, because an address nobody has proved they can read is no way back in.',
      'On a new phone, or after clearing your browser, type login and your name: a key goes to the address that name signed up with, and typing the short code from it makes this browser you again. The same email has a link, which is easier on a computer. Never make a second account — your posts stay with the first name.',
      'logout ends it on the device you are holding, and nothing else. On a borrowed phone that matters: signing in lasts over a year otherwise. Everything you said stays where it is.',
    ],
  },
  {
    heading: 'commons, which keeps nothing',
    body: [
      'One room is different. commons is a hallway: everything said there is gone in 24 hours, there are no post numbers, and there are no replies. It is for the thing not worth keeping.',
      'That is enforced by the database, not a setting: commons is structurally incapable of holding on to anything. Everywhere else keeps what you said until you ask for it to be removed.',
    ],
  },
  {
    heading: 'Your page, and your wall',
    body: [
      'go ~yourname — with the tilde — shows somebody: when they arrived, and what they have said lately, each with the address it lives at.',
      'Your own page is also your wall. Say something there and it goes on the wall rather than into a room. Only you can start something there; anybody can answer it.',
      'Walls never appear in the lobby — a room for every person would turn a building into a directory. go feed is where they all are instead: everything anybody has put on their own wall, each with its address. Say something there and it goes on your wall.',
    ],
  },
  {
    heading: 'Rooms people make',
    body: [
      'make garden asks what the room is for, then walks you into it. You need to have followed your sign-in link, and you can make three in any seven days.',
      'A room you make is not yours. No owner and no moderator — inside it you are another person in a room, like anywhere else.',
      'Make one from inside another room and that room lists it at the bottom, as having grown out of it. That line is the whole of the connection: the new room has an ordinary name and is not inside anything. It is a signpost for whoever reads the room a subject wandered out of.',
      'It sits in the lobby while people are talking in it, and drops out of the listing after a fortnight of silence — not deleted, just unlisted. Search still finds it, and it returns the moment somebody says something in it.',
    ],
  },
  {
    heading: 'Finding things',
    body: [
      'find tomatoes looks through everything anybody has said — posts and replies both — and gives you each with the address to walk to. Narrow it with --room=kitchen, --by=marisol or --since=7d.',
      'find --rooms growing searches rooms instead, by name and by what they are for.',
    ],
  },
  {
    heading: 'Replies to you',
    body: [
      'When somebody answers something you said, a count appears above the prompt. mail lists them, each with the address to go and answer. Nothing chases you — it waits until you ask, and reading it clears the count.',
      'One email a day goes with an account, only on days somebody answered you — never more, and never anything else. notify off ends it, as does the link on every one.',
    ],
  },
  {
    heading: 'Your name',
    body: [
      'rename betterchoice changes what you are called, as often as you like. Two things worth knowing: everything you have ever said follows the new name, and the name you leave is free for anybody to take the same minute.',
      'If a name recently belonged to somebody else, that is shown on the page of whoever holds it now — as a date, never as a person, so a reader is not fooled.',
    ],
  },
  {
    heading: 'What this deliberately does not have',
    body: [
      'No algorithm. Rooms are in a fixed order and posts are in the order they were said.',
      'No likes, no scores, no follower counts. There is nothing to accumulate, so there is nothing to perform for.',
      'No advertising, no analytics, no trackers, and no cookies unless you make an account — then exactly one, to keep you signed in.',
      'No private messages, no notifications that chase you, and no infinite scroll.',
      'Nothing you write is sold, licensed to anybody, or used to train anything. It stays yours; posting it here is permission to show it here.',
    ],
  },
  {
    heading: 'On a phone',
    body: [
      'This was designed on a 380-pixel screen before anything else. The buttons above the prompt are the commands that make sense where you are standing; tapping one puts the word in rather than running it.',
      'install adds it to your home screen, where it opens without the browser around it. On an iPhone the browser will not let a page do that, so it tells you which two taps to make instead.',
    ],
  },
  {
    heading: 'The rest',
    body: [
      'terms and privacy print the short version in the prompt; thewall.social/terms and thewall.social/privacy have the whole thing, written against what the code actually does. If something is wrong, or you want everything about you deleted, the address is at the bottom of both.',
    ],
  },
]
