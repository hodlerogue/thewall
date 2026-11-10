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
 *
 * The steps carry what to type as data, so `about.test.ts` can run every one
 * through the real commands, and `find`'s options come from the same table as
 * `help all`. A step that stops working fails a test instead of misleading
 * somebody on their first visit.
 */

import { USAGE } from '@/lib/commands/manual'
import type { Location } from '@/lib/shell/types'

export interface GuideExample {
  /** Where you would be standing. `about.test.ts` runs it there, for real. */
  at: Location
  type: string
  does: string
}

export interface GuideSection {
  heading: string
  body: readonly string[]
  /** A numbered step of the walkthrough, rather than background. */
  step?: boolean
  examples?: readonly GuideExample[]
  /** Ways to type a command, as `help all` prints them. Generated, never written here. */
  forms?: readonly string[]
  /** Followed on the page by the list of commands, generated from the registry. */
  commands?: boolean
}

const MUSIC: Location = { room: 'music' }
const POST: Location = { room: 'music', postId: 12 }
const LOBBY: Location = {}

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
      'Everything here is written by a person, to be read by a person. That is the whole product.',
      'These steps take about five minutes, and every example can be typed as it stands.',
    ],
  },
  {
    heading: 'What is here',
    step: true,
    body: [
      'A room is a place for one subject. The lobby is one list of the liveliest rooms, whoever opened them, and how many more there are.',
      'A post is something somebody said in a room, with a permanent number in front, never reused. A reply is an answer under a post, and is numbered too.',
      'A wall is one person’s own space, on their own page.',
      'The feed is the newest wall posts from everybody, in one place.',
    ],
  },
  {
    heading: 'Look around and walk in',
    step: true,
    body: [
      'The text before your cursor — jameson:music/12$ — is your name, the room, and what you are reading. It is also the web address: thewall.social/music/12 is that post, and a link you can send somebody.',
    ],
    examples: [
      { at: LOBBY, type: 'look', does: 'what is where you are standing' },
      { at: LOBBY, type: 'go music', does: 'walk into a room' },
      { at: MUSIC, type: 'go 12', does: 'open post 12 in that room' },
      { at: MUSIC, type: 'leave', does: 'back out one step' },
    ],
  },
  {
    heading: 'Post',
    step: true,
    body: [
      'say posts one line: a new post in a room, a reply inside a post.',
      'write takes more than one line: type it, then the post, and a line with just a dot ends it. Blank lines are paragraph breaks, up to 4,000 characters.',
      'You do not need an account to read. The first time you say something, you are asked what to call you and where to send a sign-in link, and the sentence you typed is posted for you.',
      'There are no passwords, and your address is never shown to anybody or sold. You can say one thing before you check that email — after that it asks.',
    ],
    examples: [
      { at: MUSIC, type: 'say hello, all of you', does: 'a new post in this room' },
      { at: MUSIC, type: 'write', does: 'start a longer one' },
    ],
  },
  {
    heading: 'Reply',
    step: true,
    body: [
      'Inside a post, reply answers it, and reply 2 answers reply 2, where it was written.',
      'You can answer without opening anything: in a room, reply 5 goes to post 5, and reply music/12 works from anywhere. Any number on screen is a button too.',
    ],
    examples: [
      { at: POST, type: 'reply good point', does: 'answer the post you are in' },
      { at: POST, type: 'reply 2 good point', does: 'answer reply 2' },
      { at: MUSIC, type: 'reply 5 good point', does: 'answer post 5 from the room' },
      { at: LOBBY, type: 'reply music/12 good point', does: 'answer it from anywhere' },
    ],
  },
  {
    heading: 'Your page, your wall, and the feed',
    step: true,
    body: [
      'go ~yourname — with the tilde — is your page. Anybody’s page shows when they arrived and what they have said, on their wall and in rooms, each with the address it lives at.',
      'You can only start posts on your own wall: say something on your own page and it goes there. You can answer posts on anybody’s.',
      'Walls never appear in the lobby. go feed is where they all are. Say something there and it goes on your own wall.',
    ],
    examples: [
      { at: LOBBY, type: 'go ~marisol', does: 'one person: their wall, and everything else they have said' },
      { at: LOBBY, type: 'go feed', does: 'the newest wall posts, from everybody' },
    ],
  },
  {
    heading: 'Go further back',
    step: true,
    body: [
      'A room shows its newest sixty posts; older walks back sixty at a time until you reach the first thing said there. It ends, and you can get to the end.',
      'On somebody’s page, older walks back through what they have said. The feed has no older of its own: for further back, go to one person’s page.',
    ],
    examples: [
      { at: MUSIC, type: 'older', does: 'the page before this one' },
      { at: { person: 'marisol' }, type: 'older', does: 'further back through what they said' },
    ],
  },
  {
    heading: 'Make a room, or grow one out of another',
    step: true,
    body: [
      'make garden asks what the room is for, then walks you into it. You need to have followed your sign-in link, and can make three in any seven days.',
      'A room you make is not yours. No owner and no moderator, though you can change what it says it is for with describe.',
      'To grow a room out of another, make it while standing in that room and answer y. That room lists it at the bottom, and it stays out of the lobby unless that room goes quiet. Answer n and it stands on its own. Neither can be undone.',
      'A room in the lobby drops out after two weeks of silence — not deleted, just unlisted. Search still finds it, and it returns the moment somebody posts.',
    ],
    examples: [
      { at: LOBBY, type: 'make garden what you are growing', does: 'a new room, from the lobby' },
      { at: MUSIC, type: 'make bebop the fast stuff', does: 'from inside music: asks whether it grew out of music' },
    ],
  },
  {
    heading: 'Find things',
    step: true,
    body: [
      'find looks through everything anybody has said, posts and replies both, and gives you each with its address. The options can be combined.',
    ],
    // The pipe stays out of this page (§4.8); `help all` and `what find` have it.
    forms: USAGE.find.filter((form) => !form.includes('|')),
  },
  {
    heading: 'Everything else you can type',
    step: true,
    body: [
      'help lists what you can type from where you are standing, and what <command> explains any of it. help all prints every command and every way to type it.',
    ],
    examples: [
      { at: LOBBY, type: 'help', does: 'what you can type from here' },
      { at: LOBBY, type: 'what find', does: 'one command, in full' },
      { at: LOBBY, type: 'help all', does: 'the whole manual' },
    ],
    commands: true,
  },
  {
    heading: 'commons, which keeps nothing',
    body: [
      'One room is different. commons is a hallway: everything said there is gone in 24 hours, there are no post numbers, and there are no replies. It is for the thing not worth keeping.',
      'That is enforced by the database, not a setting. Everywhere else keeps what you said until you ask for it to be removed.',
    ],
  },
  {
    heading: 'Replies to you',
    body: [
      'When somebody answers something you said, a count appears above the prompt. mail lists them, each with the address to answer. Reading it clears the count.',
      'One email a day goes with an account, only on days somebody answered you — never more, never anything else. notify off ends it, as does the link on every one.',
    ],
  },
  {
    heading: 'Your name, and a new phone',
    body: [
      'rename betterchoice changes what you are called, as often as you like. Everything you have said follows the new name, and the name you leave is free for anybody to take the same minute.',
      'If a name recently belonged to somebody else, that shows on the page of whoever holds it now — as a date, never as a person.',
      'On a new phone, type login and your name: a key goes to the address it signed up with, and typing its short code makes this browser you again. Never make a second account — your posts stay with the first name.',
      'logout ends it on the device you are holding and nothing else.',
    ],
  },
  {
    heading: 'Why a prompt',
    body: [
      'Because it says where you are without being asked, because it cannot scroll forever, and because it teaches itself. If you have never opened a terminal, you do not need to have.',
    ],
  },
  {
    heading: 'What this deliberately does not have',
    body: [
      'No algorithm. Posts are in the order they were said; the only sorting anywhere is the lobby putting busier rooms first.',
      'No likes, no scores, no follower counts. There is nothing to accumulate, so there is nothing to perform for.',
      'No advertising, no analytics, no trackers, and no cookies unless you make an account — then one, to keep you signed in.',
      'No private messages, nothing that buzzes your phone, and no infinite scroll — the daily email is the only thing that reaches you.',
      'Nothing you write is sold, licensed to anybody, or used to train anything. It stays yours; posting it here is permission to show it here.',
    ],
  },
  {
    heading: 'On a phone',
    body: [
      'The buttons above the prompt are the commands that make sense where you are standing; tapping one puts the word in rather than running it.',
      'The site prints the odd line saying what you could type next; hints off ends those.',
      'install adds it to your home screen, where it opens without the browser around it.',
    ],
  },
  {
    heading: 'The rest',
    body: [
      'terms and privacy print the short version in the prompt; thewall.social/terms and /privacy have the whole thing. If something is wrong, or you want everything about you deleted, the address is at the bottom of both.',
    ],
  },
]
