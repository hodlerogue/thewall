# thewall.sh

A social site where the entire interface is a command prompt. Rooms, posts and
replies are navigated the way a filesystem is navigated.

The design lives in [`thewall-sh-decision-doc.md`](./thewall-sh-decision-doc.md).
This is the §6 weekend build and nothing beyond it — the doc is explicit that
anything more is scope creep, and §7 records why this isn't a business.

Where the code makes a decision the document argued about, the comment cites the
section. That's deliberate: the reasoning is worth more than the code, and the
code is short.

## Running it

```bash
npm install
cp .env.example .env.local     # fill in a Supabase url + anon key
npm run dev
```

Apply `supabase/migrations/*.sql` and then `supabase/seed.sql` to the project.
There is no fallback if the keys are missing — the prompt says what's absent
rather than quietly serving fixtures.

## Testing

```bash
npm test           # 57 unit tests: parser, alias table, teaching errors, signup flow
npm run test:e2e   # 20 tests, all at 380x740 — mobile is the kill condition (§4.4, §8)
npm run test:db    # 27 assertions against the real migration, on a throwaway database
```

`test:db` wants a Postgres it can create databases in (`PGHOST`, `PGPORT`,
`PGUSER`). Against a plain cluster it applies `supabase/tests/_shim.sql` first,
which stands in for `auth.users`, `auth.uid()` and the anon roles; against a real
Supabase database, `SKIP_SHIM=1`.

## How it fits together

**The command registry is the single source of truth.** `lib/commands/registry.ts`
holds verb, aliases, gloss, detail, valid contexts and handler in one table. The
palette, `help`, `what` and the fuzzy suggestions in errors are all derived from
it, so the §3.5 alias table cannot drift away from the glossary users read.

**Two claims are enforced by the database, not by application code**, because
both are correctness rather than preference:

- *Post addresses are permanent* (§3.4). `create_post()` bumps the room counter
  and inserts in one transaction. Deleting a post renumbers nothing, freed
  numbers are never reused, and 8 concurrent writers produce zero collisions.
- *Commons keeps nothing* (§3.10). The 24-hour window is the select policy on
  `posts`, and a trigger refuses replies in ephemeral rooms. Commons is
  structurally incapable of keeping anything or growing a thread.

**Location is the only navigation state.** `{room?, postId?}` drives the prompt
string, the palette set, the valid command set and the URL at once — which is
why `thewall.sh/music/12` and `go 12` are the same address (§3.4). The lobby
lives at `/lobby` so that `/` can put arrivals in commons without making `leave`
impossible.

**Signup is an input mode, not a page** (§3.9). The sentence you typed is held
before the first question and posted the moment the account exists, so it is
never retyped; `cancel` returns to reading with nothing lost.

## Not built, on purpose

Notifications (§4.1 says design first), private messages, user-created rooms
(§4.2 leans fixed-set at launch), reply-to-reply (§4.3 makes flatness a stated
constraint, and the schema has no `parent_id` so it cannot reappear by
accident), and moderation beyond a manual kill switch.

Pipes (§4.8) are unbuilt. The doc is right that they are what separates a real
interface from a terminal costume — if this earns more hours, that is the first
thing to spend them on.

## Theme

Warm by default. §9 flags green-on-black as the obvious choice worth departing
from, and §4.5 says the taste call should be made deliberately rather than by
accumulation — so it is one line in `app/globals.css`:

```html
<html data-theme="green">
```
