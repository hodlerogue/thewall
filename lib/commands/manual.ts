/**
 * How to type each command — every form it takes, and what each one does.
 *
 * `what <command>` used to give a paragraph and nothing to copy, and the
 * forms a command takes were scattered through it: `find`'s never mentioned
 * --rooms at all. These are the shapes on their own, one per line, so a
 * paragraph can explain and this can be read down.
 *
 * Kept beside the registry rather than in it so the whole manual reads in one
 * place. `manual.test.ts` checks that every command has an entry and no entry
 * names a command that is gone, so a new verb cannot ship undocumented.
 *
 * `<words>` is something you supply; everything else is typed as it is.
 */
export const USAGE: Readonly<Record<string, readonly string[]>> = {
  look: ['look — what is where you are standing: rooms, posts, or replies'],
  rooms: ['rooms — the lobby’s list, without moving you'],
  lobby: ['lobby — straight to the lobby, from anywhere'],
  go: [
    'go <room> — into a room: go music',
    'go <number> — open a post in the room you are in: go 12',
    'go <room>/<number> — a post, from anywhere: go music/12',
    'go ~<name> — one person: their wall, and everything else they have said: go ~marisol',
    'go feed — the newest posts from everybody’s walls',
    'go lobby — the lobby',
  ],
  make: ['make <name> <what it is for> — a new room: make garden what you are growing'],
  describe: ['describe <words> — change what a room you made says it is for'],
  report: [
    'report <number> <why> — a post in this room, or a reply inside a post',
    'report room <why> — the room you are in',
    'report post <why> — the post you are in',
    'report <room>/<number> <why> — a post, from anywhere',
  ],
  say: ['say <words> — a post in a room, a reply inside a post, or a post on your own wall'],
  write: [
    'write — start a longer post, then type it a line at a time',
    '. — a line with just a dot sends it',
    'cancel — throws the draft away',
  ],
  reply: [
    'reply <words> — inside a post, answer it',
    'reply <number> <words> — inside a post, answer that reply; in a room, answer that post',
    'reply <room>/<number> <words> — answer a post from anywhere',
  ],
  who: ['who — who is in this room right now'],
  leave: ['leave — back one step: post to room, room to lobby'],
  older: ['older — in a room, the page of posts before this one', 'older — on somebody’s page, further back through what they have said'],
  what: ['what <command> — what a command does, and how to type it'],
  help: [
    'help — what you can type from here',
    'help <command> — the same as what <command>',
    'help all — this: every command, and how to type it',
  ],
  install: ['install — keep this on your home screen'],
  theme: ['theme — the themes there are', 'theme <name> — switch: warm, black, green, light'],
  hints: ['hints — whether they are on', 'hints off — stop the little instructions', 'hints on — bring them back'],
  mail: ['mail — replies to you, and clears the count'],
  notify: ['notify — whether the daily email is on', 'notify off — stop it', 'notify on — start it again'],
  rename: ['rename <name> — be called something else'],
  about: ['about — what this place is'],
  privacy: ['privacy — what is kept about you'],
  terms: ['terms — the deal, briefly'],
  doctor: ['doctor — what is running, for when something is wrong'],
  login: [
    'login <name> — send a key to the address that name signed up with',
    'login — asks which name',
    'then the code from the email — signs this browser in',
  ],
  logout: ['logout — sign this browser out'],
  resend: ['resend — send the sign-in key again'],
  find: [
    'find <words> — posts and replies that say them; inside a room, just that room',
    'find --room=<room> <words> — in one room, from anywhere',
    'find --by=<name> <words> — said by one person',
    'find --since=<time> <words> — recent only: 30m, 24h, 7d, 2w',
    'find --limit=<number> <words> — how many, 1 to 100 (20 if not said)',
    'find --rooms <words> — rooms, by name or by what they are for',
    'find <words> | count — how many there are',
    'find <words> | go — open the newest',
  ],
}
