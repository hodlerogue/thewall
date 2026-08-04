# thewall.social

A social site where the entire interface is a command prompt. Rooms, posts and
replies are navigated the way a filesystem is navigated.

The design lives in [`thewall-sh-decision-doc.md`](./thewall-sh-decision-doc.md).
This is the §6 weekend build and nothing beyond it — the doc is explicit that
anything more is scope creep, and §7 records why this isn't a business.

Where the code makes a decision the document argued about, the comment cites the
section. That's deliberate: the reasoning is worth more than the code, and the
code is short.

## Running it

### Just look at it (no database)

```bash
npm install
npm run dev:demo
```

Serves the §5 seed content from memory. Every command works, including the
whole signup flow — nothing is written anywhere. This is the one to use for the
§4.5 taste call, because that decision wants a phone, not a database.

**In a Codespace:** open the **Ports** panel, set port 3000 to **Public**, and
open the forwarded URL on your phone. It has to be Public — Private ports need
GitHub auth the phone browser won't have, which shows up as a login page rather
than the site.

### The real thing, locally

```bash
npm install
npx supabase start        # applies supabase/migrations and seed.sql for you
cp .env.example .env.local
npm run dev
```

Paste the `API URL`, `anon key` and `service_role key` that `supabase start`
prints into `.env.local`. Needs Docker — the devcontainer has it.

### The real thing, deployed

There are **two** things to apply, and running only the first leaves you with a
working schema and no rooms:

| File | What it makes |
|---|---|
| `supabase/migrations/*.sql` | the tables, policies and functions — **no rows** |
| `supabase/seed.sql` | the five rooms and everything in them (§5) |

The quickest route is the Supabase SQL Editor: paste each migration, then paste
`seed.sql`. It is plain SQL with no psql-only syntax, and it is safe to run more
than once.

Or do both at once against the connection string:

```bash
DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
  ./scripts/db-deploy.sh
```

Use that rather than `supabase db push`: push applies migrations and stops
there, leaving five empty rooms, which §5 calls worse than having no rooms.

Then add your deployed origin to **Authentication → URL Configuration →
Redirect URLs** in Supabase, or the magic link is refused on arrival.

There is no fallback if the keys are missing: the prompt says what's absent
rather than quietly serving fixtures, so you always know which one you're
looking at.

## Testing

```bash
npm test           # 111 unit tests: parser, aliases, errors, signup, search, the pipe
npm run test:e2e   # 26 tests, all at 380x740 — mobile is the kill condition (§4.4, §8)
npm run test:db    # 33 assertions against the real migrations, on a throwaway database
```

To see what is actually in a deployed project — read-only, and it tells apart
"no schema", "schema but no content", and "seed stopped partway":

```bash
DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
  ./scripts/db-check.sh
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
why `thewall.social/music/12` and `go 12` are the same address (§3.4). The lobby
lives at `/lobby` so that `/` can put arrivals in commons without making `leave`
impossible.

**Signup is an input mode, not a page** (§3.9). The sentence you typed is held
before the first question and posted the moment the account exists, so it is
never retyped; `cancel` returns to reading with nothing lost.

**One contribution, then check your email** — §4.7, revised. The doc weighed
unverified posting purely as a moderation question and never asked whether
someone can return *as themselves*. An unverified address may be a typo, so the
link it was sent to is not a recovery path; on a second device the only
reliable move is signing up again, and since names are reserved forever (§4.6)
every abandoned account burns a handle. So the held sentence still posts
instantly, and everything after it wants the link followed first — the friction
lands after the payoff, which is also what makes the link necessary rather than
decorative. `resend` sends another, because links expire.

`profiles.verified_at` is set only by `/auth/callback`, which is the one place
that can honestly claim someone read the inbox. It is deliberately not
GoTrue's `email_confirmed_at`: signup mints a session immediately, and doing
that confirms the address as a side effect, so that flag says "confirmed" for
an address nobody has proven they can read.

**Someone else speaking where you stand appears without asking.** §6 put
realtime in the stack for presence, but presence alone left commons — a
hallway, per §3.10 — unable to show you a word until you typed `look`. Posts
and replies now arrive live for wherever you are standing, and the whole thing
degrades to nothing if the channel cannot connect.

## Finding things, and the pipe

`find` searches what people have said:

```
find tomatoes
find pocket kings --room=poker
```

Matching is `ilike`, not full-text. At five curated rooms (§4.2) a scan is
honest and needs no `tsvector` column; the upgrade is a good problem to have
later. `posts`, `search` and `grep` are aliases — `posts` because it is the
name §4.8 uses, and because it reads better as a pipe source.

The pipe is the part §4.8 asks to keep quiet — "documented only inside
`what posts`, discoverable by the curious. Don't advertise it":

```
find --room=music --since=7d | count
find --by=jameson | go
```

So `find` appears in `help` and the pipe never does; `what find` is its entire
documentation. Hiding the search itself was over-applying that lean — a search
nobody can discover is barely a search.

Only `find` opts into `|` splitting, which is why `say the chord was a|b|c`
stays a sentence rather than becoming a broken pipeline. And the doc's own
example reaches for `--tag`: there are no tags, rooms do that job, and saying
exactly that is more use than listing the flags that do exist.

## Not built, on purpose

Notifications (§4.1 says design first), private messages, user-created rooms
(§4.2 leans fixed-set at launch), reply-to-reply (§4.3 makes flatness a stated
constraint, and the schema has no `parent_id` so it cannot reappear by
accident), and moderation beyond a manual kill switch.

## Theme

Warm by default. §9 flags green-on-black as the obvious choice worth departing
from, and §4.5 says the taste call should be made deliberately rather than by
accumulation — so it is one line in `app/globals.css`:

```html
<html data-theme="green">
```
