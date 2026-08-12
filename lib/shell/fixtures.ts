/**
 * Seed content, held in memory until Phase 3 moves it to `supabase/seed.sql`.
 *
 * §5 governs what is written here: an empty room is worse than no room, so the
 * rooms arrive warm — and the content reads like ordinary people (a broken AC,
 * a bad beat, a dad's records, four pounds of tomatoes), never dev in-jokes,
 * which §5 names as the first draft's failure.
 */

import type { Room } from '@/lib/shell/model'

const minutes = (n: number) => new Date(Date.now() - n * 60_000)
const days = (n: number) => new Date(Date.now() - n * 24 * 60 * 60_000)

/**
 * The people behind the names in the rooms (§3.10 — a view, not a place).
 *
 * Two of them have never followed a key, because "verified" is only worth
 * showing if the unverified state is reachable in the gate suite too.
 */
export const PEOPLE: readonly {
  name: string
  joinedAt: Date
  verified: boolean
  /** §4.6 — when this handle was last somebody else's, if it recently was. */
  nameChangedHands?: Date
}[] = [
  { name: 'jameson', joinedAt: days(96), verified: true },
  { name: 'marisol', joinedAt: days(74), verified: true },
  { name: 'tuck', joinedAt: days(41), verified: true },
  { name: 'ren', joinedAt: days(12), verified: false },
  // Took a handle somebody else had let go, which is the case the profile has
  // to warn about now that released names are free immediately.
  { name: 'dev', joinedAt: days(3), verified: false, nameChangedHands: days(2) },
]

export const ROOMS: Room[] = [  {
    slug: 'commons',
    gloss: 'everything, briefly',
    ephemeral: true,
    posts: [
      // Newest first, and the higher address is the newer post — which is what
      // `create_post` guarantees and what anything paging by address relies on.
      // These two were the wrong way round: id 1 was the *newest*, so `older`
      // walking back by address walked forwards in time here and nowhere else.
      {
        id: 2,
        author: 'marisol',
        body: 'the AC in my building has been out for three days and the super keeps saying "tomorrow"',
        createdAt: minutes(20),
        replies: [],
      },
      {
        id: 1,
        author: 'dev',
        body: 'four pounds of tomatoes from one plant. i have no plan for any of them.',
        createdAt: minutes(64),
        replies: [],
      },
    ],
  },
  {
    slug: 'music',
    gloss: 'what you are listening to',
    ephemeral: false,
    posts: [
      {
        id: 12,
        author: 'jameson',
        body: 'found my dad’s records in the garage. half of them are warped and i am keeping all of them anyway.',
        createdAt: minutes(128),
        replies: [
          { id: 1,
            author: 'marisol',
            body: 'warped ones still play, they just wobble. it grows on you.',
            createdAt: minutes(70),
          },
          { id: 2, author: 'tuck', body: 'what was in there', createdAt: minutes(44) },
        ],
      },
      {
        id: 11,
        author: 'ren',
        body: 'the bass player at the bar last night was carrying the entire band and knew it',
        createdAt: minutes(360),
        replies: [],
      },
    ],
  },
  {
    // Sixth room, added after launch. §5 to the letter: a shelf, a bicycle, a
    // lamp — things made with hands, by people who are not especially good at
    // it yet. Deliberately not side projects and shipping, which is the dev
    // in-joke §5 names as the thing that narrows the audience to people who
    // already like terminals.
    slug: 'builders',
    gloss: 'what you are making',
    ephemeral: false,
    posts: [
      {
        id: 9,
        // Whoever is newest here is a third of the share card, so it is
        // deliberately not somebody already fronting another room on it —
        // §3.11's argument is that the lobby has to read as a place with
        // people in it, and that goes double for a preview.
        author: 'tuck',
        body: 'rewired the lamp my grandmother left me and it works. i have never been so pleased with anything.',
        createdAt: minutes(50),
        replies: [],
      },
      {
        id: 5,
        author: 'ren',
        body: 'the bike is back together and there is exactly one bolt left over. i have decided it was spare.',
        createdAt: minutes(180),
        replies: [
          { id: 1,
            author: 'marisol',
            body: 'there is always one bolt. it is a law of bicycles.',
            createdAt: minutes(120),
          },
        ],
      },
      {
        id: 2,
        author: 'dev',
        body: 'spent four hours on a shelf that is still not level and i have made my peace with it',
        createdAt: minutes(300),
        replies: [
          { id: 1,
            author: 'jameson',
            body: 'level is a rumor. matchbook under the short leg and never speak of it again.',
            createdAt: minutes(240),
          },
        ],
      },
    ],
  },
  {
    slug: 'poker',
    gloss: 'bad beats and good folds',
    ephemeral: false,
    posts: [
      {
        id: 4,
        author: 'tuck',
        body: 'flopped a set, lost to runner-runner clubs, and then tipped the dealer anyway because i am a gentleman',
        createdAt: minutes(190),
        replies: [{ id: 1, author: 'jameson', body: 'the tip is the tell', createdAt: minutes(120) }],
      },
      {
        id: 2,
        author: 'jameson',
        body: 'folded pocket kings face up and i would do it again',
        createdAt: minutes(540),
        replies: [],
      },
    ],
  },
  {
    slug: 'kitchen',
    gloss: 'what you cooked',
    ephemeral: false,
    posts: [
      {
        id: 8,
        author: 'marisol',
        body: 'the trick with the tomatoes is you roast them all at once and freeze whatever you do not eat',
        createdAt: minutes(40),
        replies: [],
      },
      {
        id: 7,
        author: 'dev',
        body: 'made stock from a chicken carcass for the first time and now i understand why my grandmother never threw anything out',
        createdAt: minutes(300),
        replies: [
          { id: 1,
            author: 'ren',
            body: 'freeze it flat in bags, it stacks and it thaws in about a minute',
            createdAt: minutes(240),
          },
        ],
      },
    ],
  },
  {
    // §5: one room should be a mood, not a topic. Mood rooms are what make this
    // feel like a place rather than a forum.
    slug: 'latenight',
    gloss: 'quiet hours only',
    ephemeral: false,
    posts: [
      {
        id: 3,
        author: 'ren',
        body: 'anyone else awake or is it just me and the refrigerator',
        createdAt: minutes(480),
        replies: [
          { id: 1,
            author: 'marisol',
            body: 'the refrigerator and i are also here',
            createdAt: minutes(430),
          },
        ],
      },
      {
        id: 2,
        author: 'tuck',
        body: 'the 3am version of a problem is never the real size of the problem',
        createdAt: minutes(1800),
        replies: [],
      },
    ],
  },
  {
    /*
     * §5 again: a room is an invitation to tell somebody something, not a
     * category. "what you are holding" gets a story out of people;
     * "cryptocurrency" gets a subject line, and then a room of subject lines.
     */
    slug: 'crypto',
    gloss: 'what you are holding',
    ephemeral: false,
    posts: [
      {
        id: 2,
        author: 'tuck',
        body: 'bought the top in 2021 and have not looked since. genuinely no idea what it is worth and i think that is the healthiest thing i have ever done.',
        createdAt: minutes(95),
        replies: [
          { id: 1,
            author: 'ren',
            body: 'the not-looking is the strategy. everyone finds this out eventually',
            createdAt: minutes(60),
          },
        ],
      },
      {
        id: 1,
        author: 'marisol',
        body: 'explained a wallet to my dad for an hour and he asked which bank it was in. i did not have a good answer.',
        createdAt: minutes(300),
        replies: [],
      },
    ],
  },
  {
    slug: 'movies',
    gloss: 'what you watched',
    ephemeral: false,
    posts: [
      {
        id: 2,
        author: 'jameson',
        body: 'watched the same film my dad had on every sunday. it is not a good film. i cried at the credits anyway.',
        createdAt: minutes(140),
        replies: [
          { id: 1, author: 'tuck', body: 'that is not about the film', createdAt: minutes(100) },
        ],
      },
      {
        id: 1,
        author: 'ren',
        body: 'three minutes into a thriller i realized i had seen it before and kept going anyway, because i could not remember the ending',
        createdAt: minutes(420),
        replies: [],
      },
    ],
  },
  {
    /*
     * The room about the site itself. Not a support inbox — it is an ordinary
     * room, so a complaint gets answered by whoever is around rather than
     * disappearing into somebody's mail.
     */
    slug: 'feedback',
    gloss: 'what is broken, and what should be here',
    ephemeral: false,
    posts: [
      {
        id: 2,
        author: 'ren',
        body: 'took me three goes to work out that go 12 opens a post rather than a room. once you know it is obvious, which is the problem.',
        createdAt: minutes(75),
        replies: [
          { id: 1,
            author: 'marisol',
            body: 'same. the number being an address is the bit nobody says out loud',
            createdAt: minutes(40),
          },
        ],
      },
      {
        id: 1,
        author: 'tuck',
        body: 'wanted a room for cycling and did not realize i could just make one. the lobby looks like a fixed list.',
        createdAt: minutes(260),
        replies: [],
      },
    ],
  },
  {
    /*
     * `feed` — every wall in one place.
     *
     * A room with no posts of its own, on purpose: walls are kept out of the
     * lobby (§4.2) and this is what stops that meaning nobody ever reads one.
     * `readFeed` gathers them, `create_post` refuses this slug, and every line
     * carries the `~name/12` it really lives at.
     */
    slug: 'feed',
    gloss: 'what people are saying on their own walls',
    ephemeral: false,
    posts: [],
  },
  {
    /*
     * A wall — a room with an owner (see the walls migration).
     *
     * It is in this list because it is a room and everything that walks rooms
     * has to find it: `go ~marisol/3`, search, mail, moderation. It is kept out
     * of `listRooms` instead, which is the one place a wall must not appear:
     * §4.2's "forty rooms with three people each kills the entire feeling" is
     * exactly what a room per person would do to the lobby.
     */
    slug: '~marisol',
    gloss: 'what marisol is saying',
    owner: 'marisol',
    ephemeral: false,
    posts: [
      {
        id: 2,
        author: 'marisol',
        body: 'three days without AC and i have learned which of my neighbors own fans and which of them share',
        createdAt: minutes(15),
        replies: [
          { id: 1,
            author: 'tuck',
            body: 'the fan people are the good people. remember them in winter.',
            createdAt: minutes(9),
          },
        ],
      },
      {
        id: 1,
        author: 'marisol',
        body: 'putting things here instead of shouting them into a room feels different and i can’t say why yet',
        createdAt: minutes(220),
        replies: [],
      },
    ],
  },
]

export const DEFAULT_ROOM = 'commons'
