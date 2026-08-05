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
      'thewall.social is a small social site where the entire interface is a command prompt. You type words, and it does things. There is no feed, no like button, no follower count and no algorithm deciding what you see next.',
      'It is one place made of rooms. You walk into a room, read what people have said there, and say something back. That is the whole shape of it.',
      'It is run by one person as a side project. Free, makes no money, not trying to grow.',
    ],
  },
  {
    heading: 'Why a prompt',
    body: [
      'Because it answers "where am I" without being asked. The text before your cursor — jameson:music/12$ — is your name, the room you are in, and the thing you are reading. Nothing else on the screen has to be spent saying that.',
      'Because it cannot scroll forever. A room holds what people said in it, and when you have read it you have read it.',
      'And because it teaches itself: help lists everything you can type from where you are standing, and what <command> explains any of it. If you have never opened a terminal, you do not need to have — the buttons above the prompt put the words in for you.',
    ],
  },
  {
    heading: 'Where you are',
    body: [
      'The lobby is the list of rooms. Type look to see it, and go music to walk into one.',
      'A room holds posts. look shows them, each with a number in front: that number is its permanent address and is never reused. go 12 opens post 12 and puts you inside the conversation, where the replies are. leave backs you out one step.',
      'The path in the prompt is also the web address: if it says music/12, then thewall.social/music/12 is that post, and a link you can send somebody.',
    ],
  },
  {
    heading: 'Saying something',
    body: [
      'say, and then what you want to say. In a room that starts a new post; inside a post it adds a reply. reply does the same thing there, if that is the word you reach for.',
      'You do not need an account to read anything. The first time you try to say something, you are asked what to call you and where to send a sign-in link — and then the sentence you already typed is posted for you. You never type it twice.',
      'There are no passwords; signing in is a link. Your address is never shown to anybody and never sold. You can say one thing before following that link — after that it asks you to check your email, because an address nobody has proved they can read is not a way back in on a new phone.',
    ],
  },
  {
    heading: 'commons, which keeps nothing',
    body: [
      'One room is different. commons is a hallway: everything said there is gone in 24 hours, there are no post numbers, and there are no replies. It is for the thing not worth keeping.',
      'That is enforced by the database rather than by a setting somebody could change — commons is structurally incapable of holding on to anything. Everywhere else keeps what you said until you ask for it to be removed.',
    ],
  },
  {
    heading: 'Your page, and your wall',
    body: [
      'go ~yourname — with the tilde — shows somebody: when they arrived, and the recent things they have said, each with the address it lives at.',
      'Your own page is also your wall. Say something there and it goes on the wall rather than into a room. Only you can start something there; anybody can answer it.',
      'Walls never appear in the lobby, deliberately — a room for every person turns a building into a directory.',
    ],
  },
  {
    heading: 'Rooms people make',
    body: [
      'make garden asks what the room is for, then opens it and walks you in. You need to have followed your sign-in link, and you can make three in any seven days.',
      'A room you make is not yours. There is no owner and no moderator — inside it you are another person in a room, like anywhere else.',
      'It sits in the lobby while people are talking in it and drops out of the listing after a fortnight of silence. It is not deleted: it keeps its name, its posts and its address, search still finds it, and it comes back the moment somebody says something in it. The six original rooms never fade — they are the furniture.',
    ],
  },
  {
    heading: 'Finding things',
    body: [
      'find tomatoes looks through everything anybody has said — posts and replies both — and gives you each one with the address to walk to. Narrow it with --room=kitchen, --by=marisol or --since=7d.',
      'find --rooms growing searches rooms instead, by name and by what they are for.',
    ],
  },
  {
    heading: 'Replies to you',
    body: [
      'When somebody answers something you said, a count appears above the prompt. mail lists them, newest first, each with the address to go and answer. Nothing is pushed and nothing is emailed — it waits until you ask, and reading it clears the count.',
    ],
  },
  {
    heading: 'Your name',
    body: [
      'rename betterchoice changes what you are called, as often as you like. Two things worth knowing first: everything you have ever said follows the new name, and the name you leave is free for anybody to take the same minute — so do not release one you want back.',
      'If a name recently belonged to somebody else, that is shown on the page of whoever holds it now, as a date and never as a person. It is there so a reader is not fooled.',
    ],
  },
  {
    heading: 'What this deliberately does not have',
    body: [
      'No algorithm. Rooms are in a fixed order and posts are in the order they were said.',
      'No likes, no scores, no follower counts. There is nothing to accumulate, so there is nothing to perform for.',
      'No advertising, no analytics, no trackers, and no cookies at all unless you make an account — and then exactly one, to keep you signed in.',
      'No private messages, no notifications that chase you, and no infinite scroll.',
      'Nothing you write is sold, licensed to anybody, or used to train anything. It stays yours; posting it here is permission to show it here.',
    ],
  },
  {
    heading: 'On a phone',
    body: [
      'This was designed on a 380-pixel screen before anything else. The buttons above the prompt are the commands that make sense where you are standing, and tapping one puts the word in rather than running it.',
      'install adds it to your home screen, where it opens full screen without the browser around it. On an iPhone the browser will not let a page do that, so it tells you which two taps to make instead.',
    ],
  },
  {
    heading: 'The rest',
    body: [
      'terms and privacy print the short version in the prompt; thewall.social/terms and thewall.social/privacy have the whole thing, written against what the code actually does. If something is wrong, or you want everything about you deleted, the address is at the bottom of both.',
    ],
  },
]
