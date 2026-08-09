import {
  formatAgo,
  type Post,
  type PostHit,
  type Profile,
  type Room,
  type RoomSummary,
} from '@/lib/shell/model'
import type { Line } from '@/lib/shell/types'

/**
 * §3.2 — depth is indentation, never box drawing. Post flush, reply +1 step,
 * reply body +2. No `└─`, nothing that falls apart at 380px.
 */

/**
 * Time runs down the screen, once.
 *
 * Every query here asks for the newest N — `order by created_at desc limit 30`
 * — and that is right, because the newest N is what you want. It was then also
 * *printed* in that order, and that was wrong, for a reason particular to a
 * scrollback rather than a page.
 *
 * A page starts at the top, so newest-first puts the newest thing where the eye
 * lands. This does the opposite: `Terminal` sets `scrollTop = scrollHeight`
 * after every command, so the view lands on the **end** of what was printed.
 * Printing newest-first therefore filled the screen with the oldest posts in
 * the room and scrolled the newest ones off the top — the exact opposite of
 * what asking for the newest thirty was for.
 *
 * It also ran time in two directions at once. Your commands and their output
 * accumulate downward, so the scrollback is already oldest-at-top; a room whose
 * posts ran the other way meant scrolling up moved forward in time inside one
 * block and backward between blocks.
 *
 * So: fetch newest-first, print oldest-first. The newest thing ends up directly
 * above the prompt, which is both where you are looking and what you are most
 * likely to answer.
 */
function oldestFirst<T>(items: readonly T[]): T[] {
  return [...items].reverse()
}

/**
 * The header over something somebody said: its address, then who and when.
 *
 * One helper because every listing on the site prints this same shape, and
 * because the address in front is now a tap target — `reply 8431 ` typed into
 * the prompt for you, cursor waiting, nothing run. Written five times instead,
 * the tap would have been added to four of them.
 *
 * The address is `accent` while the rest of the header stays `dim`, which is not
 * decoration: accent is what this interface uses for a thing you can type, and
 * this is now literally that. It is the same change the room a subject grew out
 * of got, for the same reason — "that should be showing in orange to depict a
 * room but it's just normal text."
 *
 * Two spaces between the address and the name, everywhere, so a column of these
 * can be read down.
 */
function saidBy(address: string, rest: string, depth?: 0 | 1 | 2): Line {
  return {
    text: `${address}  ${rest}`,
    tone: 'dim',
    depth,
    tap: { token: address, insert: `reply ${address} ` },
  }
}

/**
 * §3.11 — proof of life: the difference between a busy building and a list of
 * doors. And §4.2's mitigation, now that anybody can add a door.
 *
 * The cap is the whole of it. "40 rooms with three people each kills the entire
 * feeling" is a claim about this list and nothing else, so the list is what is
 * bounded: the curated rooms, then the liveliest of whatever people have made,
 * and a line saying how to reach the rest. Everything stays addressable — this
 * hides nothing, it just refuses to make the front page a directory.
 */
/**
 * How many rooms people made the lobby always has space for.
 *
 * A separate number from the cap above, and the reason is a bug that grew
 * quietly. The rule used to be "twelve rooms, curated first, made ones fill
 * whatever is left" — written when there were six curated rooms, so made ones
 * got six slots. builders, crypto, movies, feedback and feed were added since,
 * one at a time, each obviously fine on its own. Curated reached ten, and the
 * space left for everything anybody had ever made was **two**.
 *
 * Measured rather than reasoned: a database with 310 rooms in it rendered the
 * ten curated ones, `room-1`, `room-2`, and "298 more rooms". Three hundred
 * rooms could be alive and the front page would look identical to a site with
 * two. Nothing failed, because no test asserted how many *made* rooms appear —
 * only that the total was capped.
 *
 * The seed's own feedback room says the quiet part: "wanted a room for cycling
 * and did not realise i could just make one. the lobby looks like a fixed
 * list." It was a fixed list, with two slots on the end.
 *
 * So made rooms get a budget rather than a remainder, and adding an eleventh
 * curated room now costs a line of length rather than a quarter of what
 * everybody else made.
 */
export const MADE_SLOTS = 6

export function renderRoomList(
  rooms: readonly RoomSummary[],
  now = new Date(),
  /** How much of the latest post to show. Narrower on a share card (1200px). */
  bodyWidth = 56,
  /**
   * Every listable room, not just the ones handed to this function.
   *
   * The lobby fetches a page now, so `rooms.length` is the size of that page —
   * counting the "more" line from it would turn "298 more" into "28 more",
   * which is worse than saying nothing, because a wrong number reads as a fact.
   * Defaults to the array for the callers that genuinely have all of it: the
   * share card, and the error paths that list what exists.
   */
  total = rooms.length,
  slots = MADE_SLOTS,
): Line[] {
  const lines: Line[] = []

  // Curated rooms are never the ones dropped. They are the furniture: the
  // building has to look the same each time you walk in, or none of §3.11's
  // argument about it reading as a place survives.
  const curated = rooms.filter((room) => room.curated)
  const made = rooms.filter((room) => !room.curated)
  const shownMade = made.slice(0, Math.max(0, slots))

  const print = (room: RoomSummary) => {
    lines.push({ text: room.slug, tone: 'accent' })
    lines.push({
      text: room.latest
        ? `${truncate(room.latest.body, bodyWidth)} — ${room.latest.author}, ${formatAgo(room.latest.createdAt, now)}`
        : 'quiet in here',
      tone: room.latest ? 'dim' : 'faint',
      depth: 1,
    })
  }

  for (const room of curated) print(room)

  /*
   * A gap and a line, before the ones people made.
   *
   * The two kinds used to run together, so the lobby read as one fixed list —
   * and a newcomer had no way to learn that making a room was a thing that
   * happens here, which is precisely the complaint the seeded feedback room
   * makes. It is also where the "more" line belongs: the rooms not shown are
   * all of this kind, never the furniture.
   *
   * Only when there are some. A site where nobody has made a room yet should
   * not have a heading over nothing — §5's empty room, as a section.
   */
  if (shownMade.length > 0) {
    lines.push({ text: '' })
    lines.push({ text: 'and rooms people made:', tone: 'faint' })
    for (const room of shownMade) print(room)
  }

  const hidden = total - curated.length - shownMade.length
  if (hidden > 0) {
    lines.push({ text: '' })
    lines.push({
      text: `${hidden} more ${hidden === 1 ? 'room' : 'rooms'} — find --rooms <word>, or go straight to one by name.`,
      tone: 'faint',
    })
  }
  return lines
}

/**
 * How many the feed asks for, and the number it admits to when it fills.
 *
 * Shared with `supabaseEnv.readFeed` and `wall_feed`'s default so the listing
 * and the sentence under it cannot disagree.
 */
export const FEED_PAGE = 40

/**
 * The feed: everything on everybody's walls, newest first.
 *
 * Rendered like search hits rather than like a room, because that is what it
 * is. A room listing puts a bare number in front of each post, and a bare
 * number is meaningless here — `2` is a different post on every wall. The
 * address carries the name, which is also what `go` wants back.
 */
export function renderFeed(
  posts: readonly PostHit[],
  now = new Date(),
  /** What the Env asked for, so a full page can say it was one. */
  limit = FEED_PAGE,
): Line[] {
  if (posts.length === 0) {
    return [
      { text: 'nothing on anybody’s wall yet.', tone: 'faint' },
      { text: 'go ~yourname and say something, and it shows up here.', tone: 'faint' },
    ]
  }

  const lines: Line[] = []
  for (const post of oldestFirst(posts)) {
    lines.push(saidBy(`${post.room}/${post.id}`, `${post.author}, ${formatAgo(post.createdAt, now)}`))
    lines.push({ text: post.body, depth: 1 })
    if (post.replies) {
      lines.push({
        text: `${post.replies} ${post.replies === 1 ? 'reply' : 'replies'} — go ${post.room}/${post.id}`,
        tone: 'faint',
        depth: 1,
      })
    }
    lines.push({ text: '' })
  }
  /*
   * No silent caps — the rule the room listing was the last place to break, and
   * the feed was quietly the next one.
   *
   * `wall_feed` takes the newest 40 and this said nothing about it, so a busy
   * feed ended on a blank line, indistinguishable from having reached the
   * bottom. That is the site's own promise — "when you have read it you have
   * read it" — being false again, in the one place somebody arriving from a
   * link lands.
   *
   * At the top, because the listing runs oldest-first: everything missing is
   * older than the first line under this. And it names walls rather than an
   * `older` command, because there is no paging here to offer — the feed
   * crosses every wall at once, so "the page before this one" is not a thing it
   * has. Naming a command that does not exist would be worse than the silence.
   */
  if (posts.length >= limit) {
    lines.unshift({ text: '' })
    lines.unshift({
      text: `the newest ${limit}. the feed doesn’t go back further — a wall does: go ~name.`,
      tone: 'faint',
    })
  }

  lines.push({
    text: 'anybody can answer any of these. say something here and it goes on your own wall.',
    tone: 'faint',
  })
  return lines
}

export function renderRoom(room: Room, now = new Date()): Line[] {
  const lines: Line[] = []

  if (room.ephemeral) {
    lines.push({ text: 'commons keeps nothing. everything here is gone in 24 hours.', tone: 'faint' })
    lines.push({ text: '' })
  }

  if (room.posts.length === 0) {
    lines.push({
      text: 'nothing here yet. say something and it will be the first thing.',
      tone: 'faint',
    })
    // Still listed. This branch returned early, which would have hidden the
    // subtopics of exactly the room most likely to have them — an empty one
    // that people walked out of into something more specific.
    lines.push(...renderGrewOut(room))
    return lines
  }

  /*
   * No silent caps — the rule this listing was the last place to break.
   *
   * `mail` says "these are the newest 100" and the lobby says "4 more rooms".
   * A room said nothing at all: it showed a page and stopped on a blank line,
   * indistinguishable from the whole room, with no way to reach the rest. That
   * is the site's own claim — "when you have read it you have read it" — being
   * quietly false in every busy room.
   *
   * At the top, because that is where the cut is: the listing runs oldest-first
   * now, so everything missing is older than the first line under this.
   */
  if (room.more) {
    lines.push({ text: 'older — the page before this one.', tone: 'faint' })
    lines.push({ text: '' })
  }

  lines.push(...renderPosts(room.posts, room.ephemeral, now))
  lines.push(...renderGrewOut(room))
  return lines
}

/**
 * Subtopics, without a tree.
 *
 * Nesting was asked for and argued down — see the migration — so a room that
 * grew out of this one is an ordinary room with an ordinary address, and this
 * line is the only thing connecting them. It sits at the bottom because that is
 * where the eye lands, and because it is navigation rather than content: read
 * the room, then see where else it went.
 */
const GREW_OUT_LIMIT = 8

function renderGrewOut(room: Room): Line[] {
  const grew = room.grewOut ?? []
  if (grew.length === 0) return []

  const lines: Line[] = [{ text: '' }]
  const shown = grew.slice(0, GREW_OUT_LIMIT)

  lines.push({
    text: `${grew.length === 1 ? 'a room' : 'rooms'} that grew out of here:`,
    tone: 'faint',
  })
  /*
   * A room name is accent, everywhere, and this was the one list that forgot.
   *
   * Reported as "that room should be showing in orange to depict a room but
   * it's just normal text" — and orange is not decoration here, it is the
   * colour this interface uses for a thing you can type. Room names in the
   * lobby, the prompt, addresses in `mail`. Printing one in the skim-past
   * colour says the opposite of what the line is for.
   *
   * Two lines rather than `slug — gloss` on one, because that is the shape the
   * lobby uses for exactly this — a list of rooms with a word about each — and
   * a room should look the same wherever it is listed.
   */
  for (const child of shown) {
    lines.push({ text: child.slug, tone: 'accent', depth: 1 })
    lines.push({ text: child.gloss, tone: 'dim', depth: 2 })
  }

  // No silent caps, here as everywhere. A room that spawned forty is not going
  // to list forty on a 380px screen, and the ones cut off are still findable.
  if (grew.length > shown.length) {
    lines.push({
      text: `and ${grew.length - shown.length} more — find --rooms <word> reaches them.`,
      tone: 'faint',
      depth: 1,
    })
  }
  return lines
}

/**
 * The posts themselves, shared by a room listing and by `older`.
 *
 * Extracted rather than duplicated: a second copy of this loop is a second
 * place to forget the reply count, the ephemeral branch, or which way round
 * time runs — and `older` prints into the same scrollback, directly under a
 * block produced by the other one.
 */
export function renderPosts(
  posts: readonly Post[],
  ephemeral: boolean,
  now = new Date(),
): Line[] {
  const lines: Line[] = []
  for (const post of oldestFirst(posts)) {
    // The number comes first because it is the address, and it is permanent.
    lines.push(
      // Commons has no addresses (§3.10), so there is nothing to print in front
      // and nothing to tap — a header there is just who and when.
      ephemeral
        ? { text: `${post.author}, ${formatAgo(post.createdAt, now)}`, tone: 'dim' }
        : saidBy(`${post.id}`, `${post.author}, ${formatAgo(post.createdAt, now)}`),
    )
    lines.push({ text: post.body, depth: 1 })
    if (!ephemeral && post.replies.length > 0) {
      lines.push({
        text: `${post.replies.length} ${post.replies.length === 1 ? 'reply' : 'replies'} — go ${post.id}`,
        tone: 'faint',
        depth: 1,
      })
    }
    lines.push({ text: '' })
  }
  return lines
}

/** §3.2 — a post is a room: you are inside the conversation, not looking at it. */
export function renderPost(post: Post, now = new Date()): Line[] {
  const lines: Line[] = [
    { text: `${post.author}, ${formatAgo(post.createdAt, now)}`, tone: 'dim' },
    { text: post.body },
    { text: '' },
  ]

  if (post.replies.length === 0) {
    lines.push({ text: 'no replies yet. say something to be the first.', tone: 'faint' })
    return lines
  }

  /*
   * Flat, numbered, and in time order — never a tree.
   *
   * "I want to be able to reply to replies." §4.3 gave replies no address,
   * which is exactly why there was nothing to answer, so they have numbers now.
   * What they did not get is nesting: an answer to an answer sits where it was
   * written, with `→ 2` saying which one it means.
   *
   * The alternative is indentation per level, and §3.2 caps depth at two steps
   * for a reason — a fourth level on a 380px screen leaves the words about two
   * characters wide. A pointer costs four characters and reads at any depth.
   */
  for (const reply of post.replies) {
    lines.push(
      saidBy(
        `${reply.id}`,
        `${reply.author}, ${formatAgo(reply.createdAt, now)}${
          reply.toReply === undefined ? '' : `  → ${reply.toReply}`
        }`,
        1,
      ),
    )
    lines.push({ text: reply.body, depth: 2 })
  }

  // Said once, at the bottom, where somebody has just finished reading and is
  // deciding what to answer. `reply` alone still answers the post, which is
  // what it has always meant.
  lines.push({ text: '' })
  lines.push({
    text: 'reply <something> answers the post — reply 2 <something> answers 2.',
    tone: 'faint',
  })
  return lines
}

/**
 * A person: what they have said, wherever they said it.
 *
 * Every post keeps the `room/id` it actually lives at, so the page stays a set
 * of doors — some opening back into rooms, some onto their own wall, which is
 * a room they own. Commons is absent by construction: `searchPosts` skips
 * ephemeral rooms, so nothing without a permanent address can appear here.
 */
export function renderProfile(profile: Profile, now = new Date()): Line[] {
  const lines: Line[] = [
    { text: profile.name, tone: 'accent' },
    {
      text: `arrived ${formatAgo(profile.joinedAt, now)} — ${
        profile.verified ? 'verified' : 'no key followed yet'
      }`,
      tone: 'faint',
      depth: 1,
    },
  ]

  // Accent, not faint. Everything else on this page is description; this is the
  // one line that changes how you should read the rest of it, and quiet is the
  // wrong volume for "this may not be who you think".
  if (profile.nameChangedHands) {
    lines.push({
      text: `this name was somebody else’s until ${formatAgo(profile.nameChangedHands, now)}.`,
      tone: 'accent',
      depth: 1,
    })
  }

  lines.push({ text: '' })

  if (profile.posts.length === 0) {
    lines.push({ text: 'nothing kept under this name yet.', tone: 'faint' })
    return lines
  }

  for (const post of oldestFirst(profile.posts)) {
    /*
     * The address, not the author: you already know whose page this is. But
     * "(reply)" is not optional, and leaving it off was a real regression.
     *
     * A profile lists what somebody has said, and once search learned to cover
     * replies this started including them — rendered identically to posts. So
     * marisol's page showed `music/12` above her answer to jameson's post, as
     * though the post were hers; following that address lands on his. `find`
     * grew the marker at the time and this did not.
     */
    lines.push(
      saidBy(
        `${post.room}/${post.id}`,
        `${formatAgo(post.createdAt, now)}${post.isReply ? '  (reply)' : ''}`,
      ),
    )
    lines.push({ text: post.body, depth: 1 })
  }

  /*
   * One instruction, and it is true of every line above it.
   *
   * This used to give a two-step recipe built from a single post: "these live
   * in rooms — go poker, then go 4". Somebody who has posted in music and poker
   * reads that as general advice, and it is only ever right for whichever post
   * happens to be newest. Reported exactly that way: "that's true for the most
   * recent post but not for any of the others, so it's just confusing."
   *
   * A whole address works from anywhere — `go` has taken them for a while — so
   * the one-step form needs no branch, applies to every line, and collapses the
   * wall case and the room case into the same sentence. The newest is used as
   * the example because it is the one directly above.
   */
  const newest = profile.posts[0]
  lines.push({ text: '' })
  lines.push({
    text: `each of those is an address — go ${newest.room}/${newest.id} opens that one.`,
    tone: 'faint',
  })
  return lines
}

/**
 * A one-line preview of something that may not be one line.
 *
 * `write` means a body can have paragraphs in it, and every listing on this
 * site shows a slice of one as a single `Line`. The scrollback renders with
 * `white-space: pre-wrap`, so a newline inside that slice really does break the
 * line — one preview would silently become two, and a lobby of them would come
 * apart.
 *
 * So the *first line* is the preview, and then it is cut to length. That is
 * also the better preview: somebody who writes a short opening line and then
 * their argument underneath has written a subject and a body, and this shows
 * the subject. Nothing had to be added to the schema for that to be true — it
 * falls out of being able to type a line break at all.
 *
 * The ellipsis says the same thing either way, so a long first line and a
 * second paragraph are not distinguished. They do not need to be: both mean
 * "there is more of this than fits here", which is what the reader is deciding
 * about.
 */
function truncate(text: string, max: number): string {
  const first = text.split('\n', 1)[0].trimEnd()
  const more = first.length < text.trimEnd().length
  if (first.length <= max) return more ? `${first}…` : first
  return `${first.slice(0, max - 1).trimEnd()}…`
}
