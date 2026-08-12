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
leaves in scope, §4.5's taste call handed to whoever is looking, and profiles —
with walls behind them, which §3.10 argued against and which are built here as
rooms with owners that never appear in the lobby. Terms and a privacy policy are
here too — the doc never mentions them, and a site that asks for an email
address needs both. Everything still out is listed at the bottom, with the
section that argues for leaving it out.

Where the code makes a decision the document argued about, the comment cites the
section. That's deliberate: the reasoning is worth more than the code, and the
code is short.

`thewall.social/about` is the same thing for people **using** it — what the
place is, why it is a prompt, and how the pieces fit. It exists against the
argument below, and answers it rather than overruling it: the part that would
rot, the list of verbs, is generated from the registry at render time, so the
page cannot say anything the prompt would not.

Four documents about the *code*, and each answers a different question:

| | |
|---|---|
| [`thewall-sh-decision-doc.md`](./thewall-sh-decision-doc.md) | what was argued |
| this file | what it is, and why each decision is what it is |
| [`CHANGING-IT.md`](./CHANGING-IT.md) | where things live, and what to do to change one |
| [`GOING-LIVE.md`](./GOING-LIVE.md) | getting it in front of people, and turning it off |

`help` lists what you can type from where you are standing and `what <command>`
explains any of it — §3.6's claim is that the interface teaches itself, so
anything unclear there is a bug in a `gloss` rather than something to document
around it.

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
| `supabase/seed.sql` | the six rooms, one wall, and everything in them (§5) |

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
npm test           # 375 unit tests: parser, aliases, errors, signup, search, themes, names, walls
npm run test:e2e   # 116 tests, all at 380x740 — mobile is the kill condition (§4.4, §8)
npm run test:db    # 195 assertions against the real migrations, on a throwaway database
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

Grants are column-scoped rather than table-wide, **on the way in as well as on
the way out**, which is the difference between a policy that constrains *whose
row it is* and one that constrains *what may change in it*. The UPDATE half was
closed early; INSERT was left table-wide for a long time and was the same hole —
a session with no profile row could create one with `verified_at` already set
and walk through the §4.7 gate without an inbox, and could choose the
`created_at` on its own replies, which decides both where a reply sorts in a
thread and whether it can ever be cleared from somebody's mail. Both bypasses that cost — self-verification and future-dating a
commons post out of its own expiry — were reachable from the browser console
with the anon key that ships in the bundle, and each now has its own negative
assertion aimed at the user's own row.

**Location is the only navigation state.** `{room?, postId?, person?}` drives the
prompt string, the palette set, the valid command set and the URL at once — which
is why `thewall.social/music/12` and `go 12` are the same address (§3.4). The lobby
lives at `/lobby` so that `/` can put arrivals in commons without making `leave`
impossible.

**Commons says nothing about post numbers, because it has none.** §3.10 gives
it no permanent addresses, so `look` there shows no numbers and `go 26` answers
"there's nothing to open here" — and the write confirmation announced "it's post
26" anyway, which sent people looking for a door that is not there. Everywhere
that keeps things, the confirmation now also says what the number is *for*: it
is the address replies arrive at, and the same number in the URL (§3.4). It
reads as a receipt otherwise.

For the same reason `reply` is not listed in `help` in commons. In the lobby or
on somebody's page it is one step from working — go to a room, open a post — and
saying so teaches the step. In commons it can never work at all, so offering it
would be advertising a dead end; typed anyway, it still explains why. `go` there
is glossed "go to another room" rather than "open a post".

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

`proxy.ts` is the other half of that — Next 16's name for what was
`middleware.ts`. `@supabase/ssr` refreshes the access
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

## Making a room

```
make garden
what is garden for?
  a few words. it goes under the name in the lobby.
> what you are growing
```

The name and what it is for, and the second is **asked** rather than demanded
on the same line. That refusal — "try: `make garden what you are growing`" —
read as a syntax error, which §3.7 says nothing here may be, and its example
was the worse half: it filled in a description belonging to a different room
and got copied verbatim, because an example somebody is told to try is an
instruction. `make onions what you are growing` is a real room that error
wrote. Both on one line still works for anybody who prefers it.

§4.2 closes room creation — *"a fixed, curated set at launch"* — because *"40
rooms with three people each kills the entire feeling"*. That is decided
differently here, and the warning is still right about the thing it is actually
about. Read it closely and it is not a claim about how many rooms exist; it is a
claim about the **room list**. A room nobody is in does no harm sitting in the
database. It does harm sitting in the lobby.

So creation opens and the lobby is what gets defended:

- **Verified, three a week.** §4.7 lets an unverified account have one
  contribution so the held sentence can land; a room is not that, so it wants an
  inbox somebody actually reads. The cap is a rolling seven days, not a calendar
  week — a week that resets on Sunday hands everybody three fresh rooms at the
  same moment.
- **The six curated rooms always show, in their curated order.** They are the
  furniture. The building has to look the same each time you walk in.
- **A user room is in the lobby while it has life in it**, and fades out after a
  fortnight of silence. That automatic fade never touches a curated room; the
  manual `moderate.sh archive` lever still can, because that one is the
  operator's hand and not a rule. It keeps its posts, its addresses and its name forever —
  it just stops taking up the shop window, and comes straight back the moment
  somebody says something in it.
- **The list is capped at twelve**, with a line saying how to reach the rest.
- **A room has no owner.** Making one does not make it yours: there is no
  moderator, and the person who opened it has exactly the powers everybody else
  in it has. `created_by` is a record of who opened the door, nothing more, and
  it is `on delete set null` so a room outlives the person who made it.
  `curated` is a separate column rather than `created_by is null`, precisely
  because of that: otherwise erasing whoever opened a room would silently
  promote it to furniture nobody chose. **`created_by` is not readable by the
  browser** — the grant on `rooms` is column-scoped and it is not in the list,
  because "a room has no owner" ought to be true of the data and not only of the
  interface. Adding the column to a table-wide `grant select` had quietly
  published the account id behind every room; it is the same shape as the bug
  that once made `verified_at` settable from a console.
- **A name somebody is using is not available**, alongside the reserved routes.
  `go marisol` and `go ~marisol` are already different addresses so nothing
  breaks — but a room sitting in the lobby under a person's name, with a gloss
  its maker chose, is aimed at exactly the reader §4.6 spends its mitigations
  protecting.

The fade is §4.2's own decay rule, which had been "written but not enabled"
since it was added. It is enabled by a clause in the lobby query rather than by
a scheduled job — nobody is running cron for this, and a decay rule that needs a
cron nobody set up is a decay rule that never runs. `archive_quiet_rooms` stays
what it was, a manual lever.

Names are checked against a table of reserved slugs, every one of them a real
path under `app/`. A room called `terms` would be shadowed by `/terms` forever:
`go terms` would work, `thewall.social/terms` would not, and §3.4's "the prompt
path is the URL" would be quietly false for exactly one room.

## Finding things, and the pipe

`find` searches what people have said, and `find --rooms` searches the rooms
themselves:

```
find tomatoes
find pocket kings --room=poker
find --rooms growing          # by name, and by what a room is for
```

**It searches replies too**, which for a long time it did not. `find` read the
posts table directly, so on a site whose §4.3 shape is "a post, then a flat list
of answers" it missed most of what anybody had said — `find bolt` found the
post about the leftover bolt and not the reply saying there is always one. Both
searches are now one function in the database over posts and replies together. A
reply carries the address of the post it is under, because §4.3 gives replies no
addresses of their own, and the result says `(reply)` so that address is not a
small lie.

`find --rooms` exists because the lobby stopped being the answer to "what is
here" the moment rooms were something people make, and a room nobody can find is
a room that dies. It searches names *and* glosses — half the time you remember
what a room was for rather than what it was called — and it includes rooms that
have gone quiet, since finding one is the way back to it. And when a bare `find`
matches nothing said but does match a room name, it says so rather than shrugging
(§3.7).

Matching is `ilike`, not full-text. At this size a scan is honest and needs no
`tsvector` column; the upgrade is a good problem to have later. The term is
escaped now — it was interpolated straight in, so a search for `100%` was a
wildcard that matched everything. `posts`, `search` and `grep` are aliases —
`posts` because it is the name §4.8 uses, and because it reads better as a pipe
source.

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

```
mail

12 replies, newest first.

music/12  marisol, 2h ago
  warped ones still play, they just wobble. it grows on you.
kitchen/8  ren, 4h ago
  freeze it flat in bags, it stacks and it thaws in about a minute
...

go music/12 to answer the newest.
```

§4.1 is the doc's own highest-priority unsolved item — "no notification means no
reason to return" — and its lean is specific enough to be implementation rather
than design: a persistent count, `mail` to list them, pull-only, no push and no
email. Unread is one column: replies to posts you wrote, newer than
`profiles.mail_seen_at`, that you did not write yourself. Reading them is what
clears the count, because in a pull-only design looking is the only signal there
is. Each one carries its `room/id`, since a notification you cannot walk to is
just an alert — and `go music/12` gets you there in one step.

**`feed` is where the walls are.** Keeping them out of the lobby was right and
left a hole: a wall is only ever found by already knowing whose it is, so
anything said on one reaches whoever thought to look — which for most walls is
nobody. `feed` is one room, in the lobby, holding what is on every wall, newest
first. It has no posts of its own and `create_post` refuses its name; each line
carries the real `~name/12`, because post numbers are per room and `2` on the
feed is a different post on every wall. `say` there goes on your own wall, since
that is the only wall you can add to and it is obviously what somebody means —
and the confirmation names the whole address, because `go 7` only works inside
the room the 7 belongs to and the feed is not it.

A room that holds nothing renders as an empty one on every surface that draws a
room from its posts, which caught four: the URL, the lobby line, the share card,
and the description in `find --rooms`. Each said some version of "nothing here
yet" about the busiest thing on the site.

**Hiding reaches the inbox**, which it did not for a long time. Neither `mail()`
nor `mail_count()` looked at `hidden_at` — not on the reply, not on the post it
hangs under, not on the room both are in — so hiding abuse, or banning whoever
wrote it, left every reply sitting in the target's inbox, still counted and
still delivered. That is the one surface that reaches out and taps somebody on
the shoulder, and the lever gets used at the moment somebody is being harassed.

## Somebody, and their wall

`go ~marisol`, or `thewall.social/~marisol` — the same value, since §3.4 makes
the prompt path and the URL one thing. It shows who they are, when they arrived,
whether they ever followed a key, and their recent posts, each carrying the
`room/id` it actually lives at.

It also shows her wall, and this is the part that changed. It began read-only,
on §3.10's warning that a space which absorbs activity "deletes the geography
that makes this feel like a place". That warning is real, but it is about the
*room list* — "forty rooms with three people each kills the entire feeling"
(§4.2) — so the answer is not to refuse walls, it is to keep them out of the
lobby.

**A wall is a room with an owner.** `rooms.owner_id`, slug `~name`, and nothing
else new:

- the address allocator, the reply trigger, mail, search, the decay policy and
  every lever in `scripts/moderate.sh` already reach it, because it is a room;
- `~marisol/2` is an ordinary post address, so it routes, shares and previews
  with no special case;
- only the owner may start something on their wall, and anybody may answer —
  which is what makes it a wall and not a diary. Both are enforced in
  `create_post`, not in the client;
- the wall is created lazily, on the first thing you put on it, so nobody has an
  empty room standing in their name;
- renaming moves it. The foreign key is `on update cascade`, so `~oldname`
  stops resolving and every post on it arrives at `~newname` (§4.6);
- and `room_overview` filters `owner_id is null`, so no wall is ever in the
  lobby. That is the one thing a wall does not inherit, and it is the whole of
  the mitigation.

The one client rule worth stating: `say` is refused on somebody else's page
*before* the signup ask, not after. A page only exists for somebody who exists,
so a visitor with no name is never on their own wall — asking would collect a
name in exchange for a sentence the wall then refuses, which is §3.9's promise
turned into a trap.

Standing on somebody is a search filter the same way standing in a room is:
`find tomatoes` there means the ones she said.

`go` also takes a whole address — `go music/12`, `go ~marisol/2` — which is the
shape `find`, `mail` and a profile all print. It was always the obvious thing to
type back and it always failed; walls only made the failure louder, since
`go ~marisol/2` used to answer "there's no one called marisol/2".

## Keeping it on a phone

```
install
```

§8 makes the phone the kill condition, and installed is where a phone stops
fighting this design: full screen, no browser chrome resizing under the
keyboard, and an icon you can reach without typing an address.

**A command, not a banner.** The browser's own `beforeinstallprompt` is caught
and `preventDefault()`-ed, which suppresses Chrome's mini-infobar — a bar across
the top of a terminal is the one interruption every other decision here has
avoided. The event is kept and replayed when somebody types `install`: caught
early, offered late.

**iOS has no install API and never has**, so `install` there prints the two taps
instead of silently doing nothing. That is most of why this is two functions
rather than one — a single `install()` that calls a browser prompt would be a
dead end on half the phones in the world, on the platform §8 names as the thing
that decides whether this works at all.

It suggests itself **once, ever, and only to somebody who already has a name** —
which means they either came back or have just been through signup. A first-time
reader thirty seconds in gets nothing; suggesting it then is the same banner in
a costume. Private browsing, where the "already said this" flag cannot be
stored, stays silent rather than repeating every load.

`public/sw.js` exists because Chrome's install criteria have wanted a service
worker with a fetch handler, and it **caches nothing on purpose**. Every screen
here is either live or a few hundred bytes; a cache-first worker would trade a
saving nobody would notice for the classic failure where a deploy goes out and
people keep running last week's JavaScript against this week's database.

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

**Agreement happens once, at the moment an account is made.** The terms used to
say "using it means agreeing", and nothing on the site had ever mentioned them —
browsewrap, with no notice, no moment of assent and nothing recorded. US courts
throw that out routinely, and the reasoning is not a technicality: somebody who
was never shown the terms did not agree to them.

§6 rules out a form and a checkbox, so it is sign-in wrap instead. The line sits
immediately above the answer that creates the account, in accent rather than the
quietest colour on the screen, and names the command that shows the document:

```
sending it makes an account, and means you agree to the terms — type terms to read them first.
```

`terms` and `privacy` both work from inside that question, which they did not
before — the prompt had been telling people to type `privacy` and answering
"that doesn't look like an email address". The signup route records
`terms_accepted_at` and `terms_version` under the service role on the same
statement that creates the account. The version is the part worth having: "they
agreed" is nearly useless once the wording has moved. There is no UPDATE grant
on `profiles` for anybody, so the record cannot be forged from a browser, and
accounts made before it existed are left null rather than backdated — a
backfilled timestamp would be inventing evidence.

**Nobody here is a lawyer, and these are not legal advice.** They are an honest
description by someone who read the code. If this ever carries money or a
company, have somebody qualified read them. One thing left to do before they go
live: point `hello@thewall.social` at an inbox you actually read.

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

**Rooms are opened from the same script**, because §4.2 closes room creation to
everybody using the site and that leaves the operator with hand-written SQL.
`new-room <slug> <gloss>` puts one at the end of the lobby; `post-as <room>
<name> <body>` puts the first thing in it, since §5's "an empty room is worse
than no room" applies hardest to a room that is new. A room made this way lives
in that database only — [`CHANGING-IT.md`](./CHANGING-IT.md) has the other half,
which is adding it to the seed so a fresh deploy has it too.

## Sharing a link

§3.4 calls shareable URLs something that "falls out of the design at zero
cost", which is true of the address and not of the preview — a link to a
conversation that previews as a bare domain is a link nobody opens.

So the card for a room or a post is a picture of the thing itself. It takes the
same `Line[]` the shell renders, from the same `renderRoom` and `renderPost`,
and paints them in the warm palette — so a preview cannot describe a site that
does not look like this. A room shows what is being said in it; a post shows the
post and its replies. That is the §3.11 argument: proof of life is what decides
whether anybody clicks.

**The front door is a fixed image** — `app/opengraph-image.png`, with its alt
text beside it — and it is the one card that does not draw itself.

It is also served by **commons**, which is not a special case so much as the
whole mechanism: `/` does not render, it redirects to commons (§3.10 puts you
there), and a crawler follows the redirect and scrapes the destination. Without
that branch the fixed card is never what a link to the bare domain previews as.
It is the right card for commons on its own terms too — everything said there
is gone in 24 hours and a scrape is cached for about a week, so a generated
card would spend most of its life advertising posts that no longer exist. It was
generated too, showing three seeded rooms, and the argument above is weaker
there than it looks: somebody who has never heard of this is not asking "what is
being said here", they are asking "what is this", and three room names answer
the second question only by accident. The cost is worth stating plainly, because
nothing enforces it: the poster does not follow the palette, the prompt or the
chips when those change, and no test can notice that it has gone stale.

It is 1200×630 and about 130 KB, both on purpose. That aspect is what every
scraper crops to, and the ones that give up on a large image are the chat apps,
where a pasted link either previews in a second or never does. `lib/brand/og.test.ts`
reads the PNG header and the byte length rather than trusting either.

Every route that a crawler can reach answers with an image, including a deleted
post, a room that never existed and `~somebody`. A card that 500s is a link
with no preview, which is the state this exists to fix.

The typeface is vendored and subset to 17K rather than fetched from a CDN at
build time: the card is meaningless in a proportional face, and a build that
reaches out to somebody else's font server is a build that fails on their
outage. `metadataBase` is not optional — Next emits a relative `og:image`
without it and every crawler rejects those, so the card would build, deploy and
never once be shown.

## Being found

Measured against the built site rather than assumed, which is the only way this
was ever going to be honest: `/music` and `/music/12` returned **two words** of
HTML — the loading line — with the same title and description as every other
URL, and `/` and `/lobby` contained **zero** `<a href>` between them. Everything
is fetched in the browser, so a search engine was handed an empty prompt and no
second page to visit.

Three things, and the third is the one that was not obvious.

**The content is in the HTML.** `components/Readable.tsx` renders the same room,
post, wall or lobby on the server, and the shell replaces it the moment it
boots. Not a hidden block and not a duplicate: it is what the site is before its
JavaScript arrives, styled like the site, and anybody can see it by switching
scripting off. That it also ends the spinner on first paint is not a
coincidence — the crawler fix and the speed fix were the same change.

**Every page says what it is.** `lib/seo/pages.ts` builds a title, a description
and a canonical from the same server-side reader the share cards use. A room is
its name and gloss and the newest thing said in it; a post is its first line,
which is the closest thing a post has to a subject.

**And there is something to follow.** This is the half that server rendering
does not fix by itself: navigation is a command prompt, so `go music` leaves no
trace a robot can walk. The lobby names every listable room as a link, a room
links to its posts, a post links back — and `app/sitemap.ts` exists because a
sitemap is the only discovery mechanism a site with no link graph has. commons
is deliberately absent from it: everything said there is gone in 24 hours and a
crawl returns in days, so every visit would find a different room and none of it
the room that was indexed.

## The page you send somebody

`/hello` is the four-second version, and the only page here allowed to sell
anything. `/about` stays what it is — 1,400 words with, in its own words, "no
marketing, no feature bullets" — which is right for somebody who has already
arrived and useless as a link in a group chat.

The hero is **the product running**, not a picture of it. `components/Demo.tsx`
builds the same fixture world the demo deploy uses, hands it to the real
`createRunner`, and plays a three-command script — `go music`, `go 12`, `who` —
typing each one out. Then it stops and the visitor has it: chips insert, `↵`
runs, and the prompt takes anything the site takes. Nothing is written anywhere.
Because the output comes from the registry rather than a transcript, a renamed
verb fails a test instead of playing a session the site would refuse.

It is deliberately not `Shell`, which owns the viewport it is in — visualViewport
maths, URL rewriting, scroll capture, a service worker — none of which belongs
in a page. The world both of them use lives in `lib/shell/demo.ts`, once.

It draws its lines through `components/Scrollback.tsx`, which is the site's own
renderer and not a copy of it — the copy it had for a day ignored `Line.prefix`,
so a contribution's echo came out flat instead of a dim prompt in front of a
bright sentence, and addresses stopped being tappable. There is one of these
now, and the suite runs the same command in both and compares the HTML.

The rest is short: three proofs, each carrying a piece of real output in the
real tones rather than an icon; a share card that the site drew when the page
loaded, fetched live from `/music/opengraph-image` because a section claiming
links preview as the conversation has to show one rather than an artist's
impression of one; and one way out, which is the prompt rather than a signup.
Everything but the demo is server-rendered, so the words are in the HTML and on
the screen before any script arrives.

Two things it does not do. `/` still redirects into commons, so nothing about
how this site is entered has changed. And `hello` is now a reserved slug, in the
schema and in the fixture, so no room can be made that the page would shadow.

**The artwork exists three times, and each copy has a job.**
`assets/thewallopengraph.png` is the master — 1731×909 as it was drawn, beside
the vendored typeface, served to nobody and kept so the other two can be made
again. `app/opengraph-image.png` is the 1200×630 crop Next attaches as the share
card, at about 130 KB because that is the size a chat app will wait for.
`public/thewallopengraph.png` is 1600×840 and is the poster at the foot of the
landing page.

**Re-export to the master, then run `node scripts/cut-artwork.mjs`.** That is
the whole procedure, and it exists because the alternative already happened: a
new export landed in `public/` alone — same filename, straight into the served
slot — and the other two went on being the previous artwork. The card is the
one that matters most and the one nobody looks at, so every link anybody pasted
would have previewed a picture that had been replaced. Nothing failed; the page
looked right, because the page shows the copy that was updated.

`lib/brand/artwork.test.ts` re-cuts both derived files and compares the bytes,
so they cannot drift from the master again without a red test naming the
command that fixes it.

All three are **drawn, not captured**, and that is the whole reason the poster
sits where it does. The rooms and commands in it are real and the layout is an
illustrator's, which makes it brand art — fine above a call to action, and not
fine as evidence for a claim about what the site produces. The cards the site
actually generates are the evidence, and the section that makes the claim shows
one of those.

## Not built, on purpose

Private messages, and reply-to-reply (§4.3 makes flatness a stated constraint,
and the schema has no `parent_id` so it cannot reappear by accident).
