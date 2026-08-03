/**
 * Phase 1 fixtures. These exist to exercise the shell on a 380px viewport
 * before any database work; Phase 3 replaces them with Supabase reads. The
 * content still follows §5 deliberately — ordinary people, no dev in-jokes —
 * so what gets tested on a phone is what will actually ship.
 */

export interface FixtureReply {
  author: string
  body: string
  ago: string
}

export interface FixturePost {
  id: number
  author: string
  body: string
  ago: string
  replies: FixtureReply[]
}

export interface FixtureRoom {
  slug: string
  gloss: string
  ephemeral?: boolean
  posts: FixturePost[]
}

export const ROOMS: FixtureRoom[] = [
  {
    slug: 'commons',
    gloss: 'everything, briefly',
    ephemeral: true,
    posts: [
      {
        id: 1,
        author: 'marisol',
        body: 'the AC in my building has been out for three days and the super keeps saying "tomorrow"',
        ago: '20m',
        replies: [],
      },
      {
        id: 2,
        author: 'dev',
        body: 'four pounds of tomatoes from one plant. i have no plan for any of them.',
        ago: '1h',
        replies: [],
      },
    ],
  },
  {
    slug: 'music',
    gloss: 'what you are listening to',
    posts: [
      {
        id: 12,
        author: 'jameson',
        body: 'found my dad’s records in the garage. half of them are warped and i am keeping all of them anyway.',
        ago: '2h',
        replies: [
          { author: 'marisol', body: 'warped ones still play, they just wobble. it grows on you.', ago: '1h' },
          { author: 'tuck', body: 'what was in there', ago: '44m' },
        ],
      },
      {
        id: 11,
        author: 'ren',
        body: 'the bass player at the bar last night was carrying the entire band and knew it',
        ago: '6h',
        replies: [],
      },
    ],
  },
  {
    slug: 'poker',
    gloss: 'bad beats and good folds',
    posts: [
      {
        id: 4,
        author: 'tuck',
        body: 'flopped a set, lost to runner-runner clubs, and then tipped the dealer anyway because i am a gentleman',
        ago: '3h',
        replies: [{ author: 'jameson', body: 'the tip is the tell', ago: '2h' }],
      },
    ],
  },
  {
    slug: 'kitchen',
    gloss: 'what you cooked',
    posts: [
      {
        id: 7,
        author: 'dev',
        body: 'made stock from a chicken carcass for the first time and now i understand why my grandmother never threw anything out',
        ago: '5h',
        replies: [],
      },
    ],
  },
  {
    slug: 'latenight',
    // §5: one room should be a mood, not a topic.
    gloss: 'quiet hours only',
    posts: [
      {
        id: 3,
        author: 'ren',
        body: 'anyone else awake or is it just me and the refrigerator',
        ago: '8h',
        replies: [{ author: 'marisol', body: 'the refrigerator and i are also here', ago: '7h' }],
      },
    ],
  },
]

export const EPHEMERAL_ROOMS = ROOMS.filter((r) => r.ephemeral).map((r) => r.slug)

export function findRoom(slug: string): FixtureRoom | undefined {
  return ROOMS.find((r) => r.slug === slug)
}

export function findPost(slug: string, id: number): FixturePost | undefined {
  return findRoom(slug)?.posts.find((p) => p.id === id)
}
