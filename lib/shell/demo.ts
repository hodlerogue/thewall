import type { FixturePerson } from '@/lib/shell/env'
import { PEOPLE, ROOMS } from '@/lib/shell/fixtures'
import type { Room } from '@/lib/shell/model'
import type { SignupApi, Writer } from '@/lib/shell/session'

/**
 * The site with nothing behind it: a world in memory, and the two stand-ins
 * that write to it.
 *
 * This lived inside `components/Shell.tsx` while there was one demo. There are
 * two now — the fixture build that the phone suite walks, and the demo in the
 * hero of the landing page — and the second copy of a fixture is exactly the
 * thing `CHANGING-IT.md` keeps warning about: **the fixture must not be a
 * different shape from the thing it stands in for**, and two of them are free
 * to drift from each other as well as from the site. So there is one.
 */

/**
 * A world nobody else is holding.
 *
 * `fixtureWriter` mutates what it is given, and the module's arrays are what
 * every test imports — so handing those over would let the demo edit the seed
 * out from under the suite. Replies are copied too, not just the posts: a
 * shallow copy would share the reply arrays, which is the half of this that
 * looks fine until somebody answers something.
 */
export function demoWorld(): { rooms: Room[]; people: FixturePerson[] } {
  return {
    rooms: ROOMS.map((room) => ({
      ...room,
      posts: room.posts.map((post) => ({ ...post, replies: [...post.replies] })),
    })),
    people: [...PEOPLE],
  }
}

/** The five the fixtures ship with. Names a demo signup may not take. */
const TAKEN = new Set(['jameson', 'marisol', 'tuck', 'ren', 'dev'])

/**
 * Fixture-mode stand-ins, so the whole signup flow can be walked without a
 * database. Nothing here runs when Supabase is configured.
 */
export function fixtureWriter(rooms: Room[], whoami: () => string | null): Writer {
  const find = (slug: string) => rooms.find((room) => room.slug === slug)

  /*
   * It writes, and that is the whole change.
   *
   * This used to hand back an address and keep nothing, so the demo answered a
   * post and then showed the same reply count a moment later — a visitor's
   * first impression being the site forgetting what they had just done. The
   * numbers were invented too: a counter starting at zero per post returned
   * "reply 1" under a thread that already had two.
   */
  return {
    async post(room: string, body: string) {
      const found = find(room)
      // Every address in a room, ever, so numbers are never reused (§3.4).
      const id = found ? found.posts.reduce((high, post) => Math.max(high, post.id), 0) + 1 : 1
      found?.posts.unshift({
        id,
        author: whoami() ?? 'you',
        body,
        createdAt: new Date(),
        replies: [],
      })
      return id
    },
    async reply(room: string, postNo: number, body: string, toReply?: number) {
      const post = find(room)?.posts.find((p) => p.id === postNo)
      // Per post, because that is what a reply number is — and counted from
      // what is already there rather than from zero.
      const id = post ? post.replies.reduce((high, reply) => Math.max(high, reply.id), 0) + 1 : 1
      post?.replies.push({ id, author: whoami() ?? 'you', body, createdAt: new Date(), toReply })
      return id
    },
    async rename(name: string) {
      if (TAKEN.has(name)) return { ok: false as const, reason: `${name} is taken` }
      return { ok: true as const, name }
    },
  }
}

/**
 * Not a secret, and not meant to be. See `login` below for why the demo hands
 * this over rather than pretending mail exists.
 */
export const DEMO_CODE = '123456'

export function fixtureSignup(people: FixturePerson[]): SignupApi {
  return {
    async checkName(name: string) {
      const available = !TAKEN.has(name)
      return {
        available,
        alternates: available ? [] : [`${name}_`, `${name}1`, `the${name}`],
      }
    },
    async resend() {
      return { note: 'nothing to send — this is a demo.' }
    },
    async logout() {
      // Nothing to end — the demo never had a session. Answering `ok` is the
      // truth of it: after this you are a guest here, same as the real site.
      return { ok: true as const }
    },
    async login(name: string) {
      // Both branches, not a single cheerful one. `login` is reachable from
      // `help` here as it is anywhere, so the fixture build is where somebody
      // finds out what it does — and "no one is called that" is half of what
      // it does.
      if (!TAKEN.has(name) && !people.some((person) => person.name === name)) {
        return {
          ok: false as const,
          reason: `no one here is called ${name}. if you’ve not been here before, say something and i’ll set you up.`,
        }
      }
      /*
       * The demo asks for a code and tells you what it is.
       *
       * The alternative — say "nothing was sent" and stop — leaves the whole
       * code flow unwalkable in the demo build and therefore untested by the
       * phone suite, which is §8's kill condition. That is the fixture-is-a-
       * different-shape trap this codebase keeps falling into: a listing that
       * paged on the real site and not in fixtures hid a truncation bug for
       * weeks.
       *
       * Saying the code out loud is honest rather than cute. Nothing was
       * emailed and nothing was kept; what is being demonstrated is the shape
       * of the exchange, and a demo that hands you the answer is obviously a
       * demo.
       */
      return {
        ok: true as const,
        name,
        codeSent: true,
        note: `nothing was emailed — this is a demo. on the real site a key would be in that account’s inbox; here the code is ${DEMO_CODE}.`,
      }
    },

    async loginCode(name: string, code: string) {
      if (code.trim().toLowerCase().replace(/[\s-]/g, '') !== DEMO_CODE) {
        return {
          ok: false as const,
          reason: `that code didn’t work. in this demo it is ${DEMO_CODE}.`,
        }
      }
      return { ok: true as const, name }
    },
    async create(name: string) {
      // Nothing is stored anywhere, but the demo does have to be able to show
      // you `~yourname` a second later, or `say` on your own wall has nowhere
      // to land and the feature cannot be tried at all.
      people.push({ name, joinedAt: new Date(), verified: false })
      // No account was made and no mail was sent. Say so — this build gets
      // deployed to public URLs, and people type real addresses into it.
      return {
        ok: true as const,
        name,
        note: 'nothing was sent — this is a demo, and your address wasn’t kept.',
      }
    },
  }
}
