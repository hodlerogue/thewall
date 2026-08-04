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

export const ROOMS: Room[] = [
  {
    slug: 'commons',
    gloss: 'everything, briefly',
    ephemeral: true,
    posts: [
      {
        id: 1,
        author: 'marisol',
        body: 'the AC in my building has been out for three days and the super keeps saying "tomorrow"',
        createdAt: minutes(20),
        replies: [],
      },
      {
        id: 2,
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
          {
            author: 'marisol',
            body: 'warped ones still play, they just wobble. it grows on you.',
            createdAt: minutes(70),
          },
          { author: 'tuck', body: 'what was in there', createdAt: minutes(44) },
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
    slug: 'poker',
    gloss: 'bad beats and good folds',
    ephemeral: false,
    posts: [
      {
        id: 4,
        author: 'tuck',
        body: 'flopped a set, lost to runner-runner clubs, and then tipped the dealer anyway because i am a gentleman',
        createdAt: minutes(190),
        replies: [{ author: 'jameson', body: 'the tip is the tell', createdAt: minutes(120) }],
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
          {
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
          {
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
]

export const DEFAULT_ROOM = 'commons'
