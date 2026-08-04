# thewall.social

A social site where the entire interface is a command prompt. Rooms, posts and
replies are navigated the way a filesystem is navigated.

The design lives in [`thewall-sh-decision-doc.md`](./thewall-sh-decision-doc.md),
which is the governing spec and is never edited — it is the record of what was
argued, including the parts that were later decided differently.

It started as the §6 weekend build. What is here now is that plus the things the
doc itself named as unfinished: §4.1's notifications, which it calls its highest
priority ("no notification means no reason to return"), §4.7 revised so an
account survives to a second device, §4.6's rename, the manual kill switch §6
leaves in scope, §4.5's taste call handed to whoever is looking, and profiles as
a read-only view. Terms and a privacy policy are here too — the doc never
mentions them, and a site that asks for an email address needs both.
Everything still out is listed at the bottom, with the section that argues for
leaving it out.

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
| `supabase/seed.sql` | the six rooms and everything in them (§5) |

```bash
DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
  ./scripts/db-deploy.sh
```

Safe to run repeatedly, and safe on a project that already has some migrations:
it probes for each one, records what is already there, and applies only the
rest. Use it rather than `supabase db push`, which applies migrations and stops
— leaving six empty rooms, which §5 calls worse than having no rooms.

**[`GOING-LIVE.md`](./GOING-LIVE.md) is the full runbook** — the environment
variables, the Supabase redirect allowlist, the Resend domain, and the
fifteen-minute manual walk that covers what no test suite here can.

There is no fallback if the keys are missing: the prompt says what's absent
rather than quietly serving fixtures, so you always know which one you're
looking at.

## Testing

```bash
npm test           # 243 unit tests: parser, aliases, errors, signup, search, themes, names, policy
npm run test:e2e   # 86 tests, all at 380x740 — mobile is the kill condition (§4.4, §8)
npm run test:db    # 106 assertions against the real migrations, on a throwaway database
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

Grants are column-scoped rather than table-wide, which is the difference between
a policy that constrains *whose row it is* and one that constrains *what may
change in it*. Both bypasses that cost — self-verification and future-dating a
commons post out of its own expiry — were reachable from the browser console
with the anon key that ships in the bundle, and each now has its own negative
assertion aimed at the user's own row.

**Location is the only navigation state.** `{room?, postId?, person?}` drives the
prompt string, the palette set, the valid command set and the URL at once — which
is why `thewall.social/music/12` and `go 12` are the same address (§3.4). The lobby
lives at `/lobby` so that `/` can put arrivals in commons without making `leave`
impossible.

**`reply` is a command, against §3.3's lean.** The doc says there is no reply
verb to learn — one verb for all contribution — and `reply` was an alias for
`say`. That cost more than it saved twice over: aliases are never announced
(§3.5), so nobody could find it, and in a *room* it resolved to `say` and
posted a brand new post, which is the opposite of what the word asks for.
Inside a post it is still exactly `say`, looked up rather than duplicated, so
there is one contribution path. Everywhere else it teaches the step people were
missing, naming a post that actually exists.

**Signup is an input mode, not a page** (§3.9). The sentence you typed is held
before the first question and posted the moment the account exists, so it is
never retyped; `cancel` returns to reading with nothing lost.

**One contribution, then check your email** — §4.7, revised. The doc weighed
unverified posting purely as a moderation question and never asked whether
someone can return *as themselves*. An unverified address may be a typo, so the
link it was sent to is not a recovery path; on a second device the only
reliable move is signing up again, and every abandoned account is a handle
nobody is coming back for. So the held sentence still posts
instantly, and everything after it wants the link followed first — the friction
lands after the payoff, which is also what makes the link necessary rather than
decorative. `resend` sends another, because links expire.

**Signup mints its two links in a specific order, and the order is load-bearing.**
GoTrue keeps one token per user per type, so minting a second magic link for the
same person overwrites the first. Signup needs two — one consumed server-side to
start the session so the held sentence can post now, one emailed — and doing
them the other way round invalidated the key before the message was sent. Every
account ever created got a dead link, and the only symptom was "that key had
already been used, or it expired" on a link a minute old.
`app/api/signup/order.test.ts` reads the route and checks the order, because no
suite here talks to GoTrue and nothing else would notice it come back.

The link in that email is built by hand from `hashed_token`, **not** from
`generateLink()`'s `action_link`. The action link points at Supabase's own
verify endpoint, which bounces back with the session in a URL *fragment* — and
a fragment is never sent to a server, so `/auth/callback` saw no token, did
nothing, and redirected. For as long as that was true the emailed key was
decorative: the only sessions anybody had came from signup consuming a second
link server-side, which meant following the key on a different device — an
email client, usually — landed you as a guest.

`middleware.ts` is the other half of that. `@supabase/ssr` refreshes the access
token by writing cookies, and without something doing it on every request the
token expires after an hour and the server stops recognising anybody. It fails
silently, an hour later, to somebody who is not looking at the code.

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

Matching is `ilike`, not full-text. At six curated rooms (§4.2) a scan is
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

## Mail, and why anyone comes back

§4.1 is the doc's own highest-priority unsolved item — "no notification means no
reason to return" — and its lean is specific enough to be implementation rather
than design: a persistent count, `mail` to list them, pull-only, no push and no
email. Unread is one column: replies to posts you wrote, newer than
`profiles.mail_seen_at`, that you did not write yourself. Reading them is what
clears the count, because in a pull-only design looking is the only signal there
is. Each one carries its `room/id`, since a notification you cannot walk to is
just an alert.

## Somebody, as a view

`go ~marisol`, or `thewall.social/~marisol` — the same value, since §3.4 makes
the prompt path and the URL one thing. It shows who they are, when they arrived,
whether they ever followed a key, and their recent posts, each carrying the
`room/id` it actually lives at.

**Nothing on a profile is postable**, and that is the whole design rather than a
missing feature. §3.10 is the doc's most emphatic architectural warning — a space
that absorbs activity "deletes the geography that makes this feel like a place" —
and a personal wall is that trap in a different hat, competing with six rooms
for the one conversation a small community has. So `person` is a valid context
for every verb except `say`, the palette there omits it, and `say` on a profile
answers "you have to be in a room first". The read-only version is a strict
subset, so walls can be built on top later without rework.

Standing on somebody is a search filter the same way standing in a room is:
`find tomatoes` there means the ones she said.

## Colours

Four themes, changed with a command and remembered per browser:

```
theme            # lists them, marks yours
theme black
```

warm (default), black (true `#000`, kindest to OLED and the highest contrast),
green (the phosphor palette §9 names as the obvious choice worth departing
from), and light (paper, for daylight and for people who find light-on-dark
hard to read). Every token in every theme has its contrast ratio asserted in
`lib/shell/themes.test.ts`, so a new palette cannot ship illegible and none can
regress quietly.

## Your name

`rename betterchoice`, as often as you like. §4.6 leaned one rename ever with
the old name reserved forever; both halves are decided differently here, and
the second is the one that costs something.

Unlimited, because "someone who picks badly at 2am is stuck with it" — §4.6's
own words — is not a once-in-a-lifetime event, and a cap only moves the trap
along by one. Released immediately, because a name nobody is using is a name
nobody is using.

That trade has a real edge. Posts join `profiles.name` live, so renaming
rewrites attribution on everything you ever said, and the handle you drop can
be taken the same minute. So the mitigation is disclosure rather than a lock:

- The prompt says both consequences out loud at the moment you rename, rather
  than leaving you to find out.
- A name that recently changed hands says so on the profile of whoever holds it
  now — which is where impersonation actually lands, on the reader.
- That notice is a date and never a person. Publishing *whose* name it was
  would make renaming useless to the one person §4.6 exists for: somebody
  walking away from a handle they regret.

`name_history` has RLS on and no policies, so nothing can read it — the only
way in is one function that returns a timestamp. And there is no UPDATE grant
on `profiles` anywhere, so `change_name()` is the only door, which is what makes
"record the old one" and "not while banned" impossible to route around.

## Terms and privacy

`terms` and `privacy` in the prompt print the short version; `/terms` and
`/privacy` are the whole thing, for anyone who has not typed anything yet. The
signup question that asks for an address names them in the same breath, because
that is the moment somebody is owed a way to read what happens to it — a link
in a footer nobody scrolls to is not consent.

They were written against what the code does rather than from a template, which
is the part a template cannot do: the retention periods are the ones the
database enforces, the processor list is the three services the code actually
talks to, and the data inventory came out of the schema. `lib/legal/documents.test.ts`
asserts the parts that could quietly stop being true — a reachable contact, a
named processor for each third party, a stated lawful basis and retention, and a
working deletion route.

**Nobody here is a lawyer, and these are not legal advice.** They are an honest
description by someone who read the code. If this ever carries money or a
company, have somebody qualified read them. Two things to do before they go
live: point `hello@thewall.social` at an inbox you actually read, and check the
governing-law clause says the right country.

Erasure is `./scripts/moderate.sh forget <name>` — the address and the handle
go permanently, and what they posted stays up attached to a handle that is
nobody. That is anonymisation rather than deletion on purpose: deleting the row
cascades away every reply *other people* wrote underneath them, which is
somebody else's speech being destroyed to satisfy a request that was never
about it. If they want their posts down too, that is `ban`, and they have to ask.

## The kill switch

§6 puts moderation tooling out of scope "beyond a manual kill switch", so the
manual part is a script and there is deliberately no admin account, no admin
column and no in-app moderation surface — an admin bit a signed-in user can be
checked against is an escalation target that buys nothing when the operator is
one person with psql (§7).

```bash
DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
  ./scripts/moderate.sh who
```

Everything is a soft delete and everything is reversible. A hidden post keeps
its row, its address and its replies; a banned account keeps its name, so the
handle stays reserved and dead (§4.6) rather than freed for whoever wants it
next. The lever that looked obvious — deleting the account — is the wrong one:
it cascades away every reply *other people* wrote underneath them.

Contributing is also rate limited, which it was not at all: twenty posts and
replies together per five minutes, far above a fast conversation in a hallway
and far below anything worth scripting.

§4.2's decay rule is here too, and is called by nothing — "written but not
enabled", exactly as the doc leans. `./scripts/moderate.sh archive` runs it by
hand: quiet rooms drop out of the lobby, stay reachable by name, and come back
the moment somebody posts in them.

## Sharing a link

§3.4 calls shareable URLs something that "falls out of the design at zero
cost", which is true of the address and not of the preview — a link to a
conversation that previews as a bare domain is a link nobody opens.

So the card is a picture of the thing itself. It takes the same `Line[]` the
shell renders, from the same `renderRoom`, `renderPost` and `renderRoomList`,
and paints them in the warm palette — so a preview cannot describe a site that
does not look like this. A room shows what is being said in it; a post shows
the post and its replies; the front door shows three rooms with proof of life
(§3.11), because a card of rooms reading "quiet in here" is the §5 failure mode at
1200×630.

Every route that a crawler can reach answers with an image, including a deleted
post, a room that never existed and `~somebody`. A card that 500s is a link
with no preview, which is the state this exists to fix.

The typeface is vendored and subset to 17K rather than fetched from a CDN at
build time: the card is meaningless in a proportional face, and a build that
reaches out to somebody else's font server is a build that fails on their
outage. `metadataBase` is not optional — Next emits a relative `og:image`
without it and every crawler rejects those, so the card would build, deploy and
never once be shown.

## Not built, on purpose

Private messages, user-created rooms (§4.2 leans fixed-set at launch),
reply-to-reply (§4.3 makes flatness a stated constraint, and the schema has no
`parent_id` so it cannot reappear by accident), and personal walls (see above).
