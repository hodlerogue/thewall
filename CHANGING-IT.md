# Changing it

Four documents, and this is the third of them:

| | |
|---|---|
| [`thewall-sh-decision-doc.md`](./thewall-sh-decision-doc.md) | what was argued. Never edited, including the parts decided differently since |
| [`README.md`](./README.md) | what it is, and why each decision is what it is |
| **this file** | where things live, and what to do to change one |
| [`GOING-LIVE.md`](./GOING-LIVE.md) | getting it in front of people, and turning it off |

The README answers "why is it like this". This answers "I want to add a verb —
what do I edit, and what will bite me". It is a checklist, not an argument.

**There is a user-facing rundown, and it is not a command reference.**
`/about` — `lib/guide/about.ts` for the prose, `app/about/page.tsx` for the
page — says what the place is, why it is a prompt, and how the pieces fit.

That was argued against here for a while, on the grounds that a hand-written
command list drifts away from the registry and leaves two answers to one
question with one of them wrong. The argument is right about a *reference* and
says nothing about the rest: it answers "what can I type" and has nothing for
somebody looking at a command prompt on a social site and wondering what they
have found. So the objection is answered rather than overruled — **the list of
verbs on that page is generated from `COMMANDS`**, and `lib/guide/about.test.ts`
fails if the prose grows its own copy.

Two rules for it. It renders `gloss`, never `detail`, because `find`'s detail
carries the pipe example and §4.8 asks that the pipe stay undiscovered rather
than published under a heading reading "everything you can type". And hidden
commands stay off it entirely.

Everything else still holds: if something is unclear *while using it*, the fix
goes in a `gloss` or a `detail`, not into that page.

---

## The shape, in one paragraph

A **command registry** turns typed text into **lines**. Commands read and write
through one interface, **`Env`**, which has two implementations — memory and
Supabase — and never learns which one it has. Where you are standing is a single
value, **`Location`**, which drives the prompt, the palette, the valid command
set and the URL at once. Identity lives in **`Session`**, not in `Env`, because
who you are is a property of the conversation. Everything a person could type
their way into is enforced in the **database**, not in the client.

```
Terminal.tsx ──typed text──> run.ts ──parse──> registry.ts ──> Env ──> Supabase
     ^                                              |                    or
     └──────────────── Line[] ─────────────────────┘                 fixtures
```

## The map

**The shell** — everything that is true whether or not there is a database.

| File | What it owns |
|---|---|
| `lib/shell/types.ts` | `Location`, `Context`, `Line`, and the URL ↔ location functions |
| `lib/shell/model.ts` | `Room`, `Post`, `Reply`, `Profile` — the domain shapes |
| `lib/shell/render.ts` | shapes → `Line[]`. All §3.2 indentation lives here |
| `lib/shell/env.ts` | the `Env` interface, and the in-memory implementation |
| `lib/shell/fixtures.ts` | the §5 seed content, in memory |
| `lib/shell/session.ts` | §3.9 — the held sentence, the signup questions, your name |
| `lib/shell/errors.ts` | anything thrown → something a person can act on |
| `lib/shell/themes.ts` | §4.5 — the four palettes and their tokens |
| `lib/pwa/install.ts` | adding it to a home screen, and the two platforms that differ |

**Commands.**

| File | What it owns |
|---|---|
| `lib/commands/registry.ts` | **THE table.** Every verb, and every handler |
| `lib/commands/run.ts` | typed text → the right handler; the palette |
| `lib/commands/parse.ts` | head + argument, and alias resolution |
| `lib/commands/pipeline.ts` | §4.8 — `\|`, and the `--flag` parser |

**Data.**

| File | What it owns |
|---|---|
| `lib/data/supabaseEnv.ts` | the reading half — the `Env` the site actually runs on |
| `lib/data/writer.ts` | the writing half — posts, replies, renames |
| `lib/data/live.ts` | realtime: presence, and posts arriving while you stand there |
| `lib/supabase/{client,server,reader}.ts` | the three clients: browser, route handler, and unauthenticated read |

**An instruction printed under a list has to be true of the whole list.** A
profile closed with "these live in rooms — go poker, then go 4", built from
whichever post was newest and printed under posts spanning several rooms. It was
right for one line and wrong for the rest, which is worse than saying nothing:
somebody who follows it once and finds it works learns a rule that then fails.
A whole address works from anywhere, so the one-step form is true of every line
and needs no branch for walls either. When a closing line names an example, make
sure it is an example of a rule rather than a route.

**Never decorate a value before comparing it.** Live arrivals suppress your own
posts by comparing the author to your name — and the caller built the display
string first, `20  ryan`, and passed that as the author. So the comparison asked
whether `20  ryan` was `ryan`, and everything anybody said in a room came back
down the channel and printed underneath itself. It worked in commons alone,
because there the address is absent and the two strings were accidentally equal
— and commons is the room every signup test uses, which is why it survived.

The fix worth copying is the shape rather than the line: the address is its own
field on `Arrival`, so there is no parameter left that a rendered string can be
passed to. When an identity check and a display string are built from the same
value, separate them in the type.

**Erasure anonymises, so `on delete cascade` never fires.** `forget` renames the
profile to a tombstone and blanks the address; it does not delete the row,
because deleting it would take every reply other people wrote under that
person's posts. The consequence catches every table added afterwards: a new
table keyed on `profile_id` survives an erasure untouched unless `forget`
deletes from it by name. `notify_settings` was written without that and held a
preference, a last-sent timestamp and an unsubscribe token for somebody who had
asked to be gone. **Adding a table keyed on a profile means editing `forget`.**

**A column on `profiles` is public.** `grant select on public.profiles` is
table-wide and always has been, so anything added there is readable by anybody
holding the anon key — which ships in the browser bundle. That is right for a
name and wrong for a preference, a timestamp or a token, which is why the
notification settings are their own table with no grants and no policies,
reached only through `security definer` functions. Before adding a column to
`profiles`, ask whether you would publish it, because you are.

**Getting in and back in.** Four routes, and they are easy to confuse because
three of them mint magic links for different reasons.

| File | What it owns |
|---|---|
| `app/api/signup/route.ts` | §3.9 — makes the account, signs it in now, mails the key |
| `app/api/verify/resend/route.ts` | another key for **this** session, when the first expired |
| `app/api/login/route.ts` | a key for a name, for a browser with **no** session — the way back in |
| `app/auth/callback/route.ts` | the only thing that has ever made somebody signed in |
| `app/api/logout/route.ts` | ending it on this device, `scope: 'local'` |
| `app/api/digest/route.ts` | the daily email, POST + shared secret, off when unconfigured |
| `app/unsubscribe/page.tsx` | stopping it with no session, from the link in the email |

`login` and `resend` are not variants of each other. `resend` reads the address
off `auth.getUser()`, so it cannot work without a session; `login` exists
precisely for the case where there is none, takes a public name, and is
therefore the one that needs two rate limits — one per caller, one per account
aimed at, so nobody can fill a stranger's inbox with keys.

**React**, of which there is deliberately very little.

| File | What it owns |
|---|---|
| `components/Shell.tsx` | boot: picks fixtures or Supabase, builds the runner, arrives at the URL |
| `components/Terminal.tsx` | the prompt, the scrollback, history, the mobile viewport maths |
| `components/Palette.tsx` | the chip strip |
| `app/globals.css` | every token, every theme, and the whole layout |
| `app/manifest.ts`, `public/sw.js` | what a phone reads before offering to install |

**The database.** `supabase/migrations/*.sql` in filename order, then
`supabase/seed.sql`. `supabase/tests/schema.test.sql` runs against the real
migrations on a throwaway database.

---

## Add a command

Everything about a verb is one entry in `COMMANDS` in `lib/commands/registry.ts`.
The palette, `help`, `what`, and the "did you mean" pool are all derived from it,
so there is nothing else to register.

```ts
{
  verb: 'listen',                    // §3.5 — an English verb, not a Unix one
  aliases: ['hear', 'tune'],         // Unix names go here, and are never announced
  contexts: ['room', 'post'],        // where it means anything
  gloss: (c) => 'what is playing',   // `verb — gloss`, per place you stand
  detail: () => 'plain english, for `what listen`.',
  insert: () => 'listen ',           // trailing space when an argument follows
  wrongContext: (_c, hint) => `you have to be in a room first. try: go ${hint}`,
  async run({ arg, location, context, env, hint, session }) {
    return { lines: [{ text: '…' }] }
  },
}
```

Then, if it should be in the palette, add the verb to `CHIP_SETS` in the same
file — and to `OWN_WALL_CHIPS` if it belongs on your own page.

**What will bite you:**

- **No dash inside a `gloss`.** `help` renders `verb — gloss`, and a second dash
  turns the line into a puzzle.
- **Six chips maximum per context, and `say` and `help` come first.** Both are
  asserted. The palette is a horizontal scroller at 380px; roughly one chip fits.
  Third place is off the right edge of the screen with nothing to say it was
  there — which is exactly how the primary action shipped invisible once.
- **`wrongContext` must name the fix, never report a failure** (§3.7). Use the
  `hint()` argument so the room you name is one that exists.
- **`hint()` is a database round trip.** Call it only on the path that needs it.
  It is a function rather than a value because making it eager broke `help` —
  the command a confused person reaches for — whenever the database blipped.
- **Every chip must be runnable where it is offered.** `profile.test.ts` walks
  every context × every chip and asserts the command is valid there and not
  hidden.
- **`hidden: true`** keeps it out of `help`, the palette and the suggestion pool,
  but `what <verb>` still explains it. That is §4.8's deal for the pipe, and how
  `doctor` stays out of a newcomer's way.
- **`pipeable: true`** is what opts a verb into `|` splitting. Without it a pipe
  character is just a character in your sentence, which is what keeps `say i
  like cats | dogs` from becoming a syntax error nobody asked for.
- **`hidden: true` is only safe when something else names the verb.** `resend`
  can hide because the message that needs it says "type resend". `login` cannot,
  because the person who needs it has no session, so no message has fired, and
  they are looking at exactly what a stranger sees. Ask who has to find this and
  what they are looking at when they need it.
- **The second `help` group prints in `ELSEWHERE` order, not registry order.**
  It used to follow the file, which put every newly added verb last by accident.
  If a verb belongs near the top of that list, put it near the top of the array.

## Add a room

**Anybody verified may make one, three a week** — `make garden what you are
growing`. §4.2 argued for a closed set and that is decided differently now; see
the README for why, and for what defends the lobby instead.

Still true, and still asserted: `anon` and `authenticated` hold `select` on
`rooms` and nothing else. No insert, no update, no delete. `create_room` is a
`security definer` function and is the only door, so every rule about who may
and how often is unroutable-around rather than a policy somebody has to get
right twice. Walls are the other narrow path: `create_post` makes a room only
when the slug starts with `~` **and** matches the caller's own name.

**A room made from inside another room records where it was made** — that is
`rooms.from_room`, set by `create_room`'s third argument, and it is a label for
discovery and nothing else. No address contains it (`bebop`, never
`music/bebop`), no permission reads it, and the lobby ignores it. The parent
lists its children at the bottom of the room listing via `rooms_from()`; that
line is the entire feature. Nesting was asked for and argued down: an address
that grows a segment per level stops being typable on a phone, `go` would have
to mean two things, and a tree of near-empty rooms is §5's "an empty room is
worse than no room" once per level.

The claim is checked in `create_room` rather than trusted, because `p_from`
comes from a browser: a parent that does not exist, is a wall, or is the room
being made is dropped — **and the room is still made**. Refusing there would
lose somebody's sentence over a label they never asked for.

**Adding a route to `app/` means adding a row to `reserved_slugs`.** Every entry
there is a real path. A room called `terms` would be shadowed by `/terms`
forever — `go terms` would work, `thewall.social/terms` would not, and §3.4
would be quietly false for exactly one room.

For the operator there are still two ways, and they answer different questions.

### On a live project, now

```bash
DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
  ./scripts/moderate.sh new-room garden 'what you are growing'
```

It goes to the end of the lobby — the last position is the only one that is
right by default, since inserting into the middle silently demotes something
else. Then put something in it, in the same breath:

```bash
./scripts/moderate.sh post-as garden ren 'four tomato plants and a lot of optimism'
```

§5 is not being decorative about this: *"an empty room is worse than no room.
The demo cannot launch to a ghost town."* A room created and left empty reads as
a dead site rather than a new topic, and the person who has to fix that within
the hour is you. `post-as` writes under a real name, which is the one lever in
`moderate.sh` that puts words in somebody's mouth — use your own account, or one
of the `.invalid` seed accounts. It is undone with `hide <room> <number>`.

This room exists **only in that database.** The demo, the e2e suite and the next
project you deploy will not have it.

### In the codebase, so every deployment has it

1. `supabase/seed.sql` — the `rooms` insert, **and** the `sort_order` update
   below it. `on conflict do nothing` skips a room that already exists, so a
   project seeded earlier would keep the old ordering and end up with two rooms
   tied. The explicit update is what stops that.
2. `lib/shell/fixtures.ts` — the same room with the same content, so
   `npm run dev:demo` and the e2e suite show what the site shows.

If it should be on the share card, add the slug to `ON_THE_CARD` in
`lib/brand/ogRooms.ts`. `lib/brand/og.test.ts` refuses a card that advertises a
room which does not exist.

Doing both is normal: `moderate.sh` opens it tonight, the seed edit means it is
still there after the next `db-deploy.sh` on a fresh project.

### What will bite you

- **A slug is 2–24 characters of `a-z`, `0-9` and `-`**, and it cannot start with
  `~` — that spelling is reserved for walls. Both are check constraints; the
  script refuses them in a sentence first.
- **`sort_order` decides the lobby, and ties are undefined.** Two rooms with the
  same number order arbitrarily and differently per query.
- **An address is never reused** (§3.4). A post that fails to insert after the
  room counter has been bumped leaves a permanent hole in that room's numbering,
  which is why `post-as` checks the name exists before it touches the allocator
  and does the bump and the insert in one statement.
- **`new-room` is not `open`.** `open` un-hides a room `close` hid; `new-room`
  makes one that never existed.

## Add a migration

1. Write `supabase/migrations/<timestamp>_<name>.sql`.
2. **Add a probe line to `scripts/migrations.sh`** — one object that only this
   migration creates. `db-deploy.sh` fails loudly if you forget, rather than
   skipping your migration forever. A hosted project does not get its migrations
   from a CLI; they are pasted in by hand, one at a time, so "some of them" is
   the normal state and the probe is how anything knows.
3. **Add a probe to `diagnose()` in `lib/data/supabaseEnv.ts`**, so `doctor`
   names your migration when it is missing. Probe a *column*, never a function —
   calling `mark_verified` to ask whether it exists would mark you verified.
4. Write assertions in `supabase/tests/schema.test.sql`, then `npm run test:db`.

Deploy with `./scripts/db-deploy.sh`, never `supabase db push` — the latter
applies migrations and stops, leaving a schema with no rooms in it.

**The plpgsql trap that already cost a real bug:** a `STABLE` function sees the
snapshot from the start of the *statement*, so
`select create_post(...) from generate_series(1,25)` passed a one-per-account
gate twenty-five times. If a function reads a row it is about to change the
answer for, it is `VOLATILE`.

## Add something to the Env

`Env` in `lib/shell/env.ts` is the only thing command handlers may talk to.
Adding a method means implementing it **twice** — `fixtureEnv` in the same file,
and `supabaseEnv` in `lib/data/supabaseEnv.ts` — and the fixture is not a stub:
the e2e suite runs entirely against it, so a fixture that lies produces a green
suite over a broken site.

Identity does not go here. `Session` owns it.

## Add a theme

An entry in `THEMES` in `lib/shell/themes.ts`, and the matching
`:root[data-theme='...']` block in `app/globals.css`. `themes.test.ts` asserts
the contrast ratio of every token in every theme, so a new palette cannot ship
illegible and none can regress quietly. That test exists because the warm
`faint` was 3.14:1 and the chip gloss 2.95:1 — and the gloss is the exact text
§3.6 says makes this legible to someone who has never opened a terminal.

---

## The invariants

Break one of these and something is wrong that no type checker will mention.

**One address, one context.** `{room: '~marisol'}` and `{person: 'marisol'}`
would print the same prompt and the same URL — and `/~marisol` parses back to
the person, so a reload would flip you between them. Anything that produces a
`Location` must produce the one the path parses to. `locationToPath` and
`pathToLocation` are the arbiter; `types.test.ts` round-trips them.

**The address is the database's to allocate, never the client's** (§3.4).
Posting goes through `create_post()`, which bumps the room counter and inserts
in one transaction. Numbers are never reused, and eight concurrent writers
produce zero collisions — there is an assertion that proves it.

**Grants are column-scoped, not table-wide.** A row policy constrains *whose row
it is*; it says nothing about *what may change in it*. Table-wide `UPDATE` plus
a row policy is how anyone could set their own `verified_at` from the browser
console with the anon key that ships in the bundle. Every new column that means
something needs its own negative assertion, aimed at the user's **own** row.

**Nothing typed is ever lost** (§3.9). If a write can fail, the handler returns
`retry` with the sentence in it. Clearing the input before the await is how a
network blip used to eat somebody's paragraph.

**Ask for an account only when the account would help.** `say` on somebody
else's wall is refused *before* the signup ask, because a page only exists for
somebody who exists — asking would collect a name in exchange for a sentence the
wall then refuses. The rule generalises: never ask for identity in front of a
refusal that identity would not lift.

**Errors teach** (§3.7). Name the fix, name a real one, and never say "invalid
syntax". If an error names an address, resolve one that exists rather than
inventing a number.

**An error's suggested fix has to be one the site will accept.** Stronger than
the rule above, learned the expensive way, and then broken again one commit
after being written down here — the message added to close the loop below said
"if it's taken by you, type login ryan", and mid-signup everything typed is an
answer, so `login ryan` went to the name check, failed for containing a space,
and offered `login_ryan`. Typing what the screen says has to work. Where an
instruction is printed inside a question, the question has to honour it: see the
`login <name>` escape beside `cancel` in `answer()`. Every individual message in the
loop below was true, helpful in tone, and named a next step:

```
resend  → "this browser isn't signed in. say something and i'll ask for your
           address again — if the name is already yours, use the same one."
say     → "what should i call you?"
ryan    → "ryan is taken. ryan2, ryan_ are free."
```

Followed end to end, that walked a returning person into a **second account**,
and the first name's history stayed on the name they had abandoned. Nothing was
wrong at any single step; the advice was wrong as a path. When you write an
error that says "try X", type X into the thing and see what it answers.

**Every contribution answers with exactly one line, in `accent`.** A room post
gives its new address, a wall post gives `~name/7`, a reply gives the address of
the post it is under (§4.3 — it has none of its own, and the post's is what you
would type to come back), and commons gives the one surviving word, `said.`,
because it is the only place with no address to give.

Two things this went through, both worth not repeating. It printed `said.`
everywhere, which is a delivery receipt under every sentence. Then it printed
nothing at all where there was no address — and "instead of just LOOKING like
it's sent" is what nothing reads as, because `live.ts` drops your own words from
the channel so the screen does not otherwise change. And the tone was `dim`:
both tones clear 4.5:1, so it was never legibility, it was hierarchy. `dim` is
what this interface uses for things you skim past, so the one line saying "that
happened" was in the skim-past colour.

**"Is there anything waiting" and "is there anything new" are different
questions.** The daily digest gated on the first and had to gate on the second:
somebody who is emailed and never reads their mail still has the same pile
tomorrow, so the first version sent the identical email every day for as long as
it sat there — the exact daily nag the feature is written not to be, and a
contradiction of the sentence `notify` itself prints. It sends on *new since the
last email* and reports *everything unread*, so the number still matches the
badge. Three attempts at the test for this passed against the broken function,
because everybody in the seed has replies at assorted recent ages; it needed its
own person with every timestamp controlled.

**Success prints a value, or it prints nothing. Never a status word.** `cp`
says nothing when it works, and a prompt that answers `said.` under every
sentence is a chat client with delivery receipts wearing a terminal's clothes.
What a successful `say` prints is the *address* — `music/7` — because that is
the one fact about the post which is not already on the screen; your own words
are on the echo line directly above it. Where there is no address there is no
output: a reply has none (§4.3) and neither does commons (§3.10).

Two things make this safe, and both are load-bearing:

- `lib/data/live.ts` deliberately drops your own posts from the realtime
  channel, so nothing arrives to show you. Silence works because the echo line
  is the receipt — not because the room visibly changed. If own-post
  suppression ever goes, revisit this.
- **Any line that introduces the output has to read as finished without it.**
  "now — the thing you were trying to say." was a heading for a confirmation;
  the moment the confirmation stopped printing, commons and replies ended on a
  promise followed by blank, which is worse than the receipt it replaced. It
  now reads "and the thing you were trying to say is up." Fixture tests cannot
  see this — the lines were all individually correct. It was found by
  screenshotting the three cases at 380×740 and looking at them.

**A fixture may be small. It may not be a different shape.** `fixtureEnv.getRoom`
returned every post a room had while `supabaseEnv` capped it, so a 500-post room
came back with 500 posts in every suite and 60 on the real site. Truncation
therefore did not exist anywhere a test could see it, which is how a room
silently showing a slice — no notice, no way back — survived to be found by
hand. Both Envs now page against the exported `ROOM_PAGE`, and
`lib/commands/older.test.ts` opens by asserting they agree. This is the third
time this session that a fixture disagreeing with the database produced a green
suite over broken behaviour; when you add an Env method, write the fixture and
the real one in the same sitting and pin them together.

**"I asked for N and got N" does not mean there are more.** It is the same
answer for "exactly N" and "ten thousand". Fetch `N + 1`, show `N`, and report
whether the extra arrived — `Room.more` is that, and without it a room holding
exactly one page would advertise an `older` that finds nothing.

**Don't let a render loop make a product decision.** A room showed 30 posts
because `MAX_LINES` was 600, and `MAX_LINES` was 600 because `input` is state on
`Terminal`, so every keystroke re-rendered every line — measured at ~0.007ms per
line per keystroke, a few ms on desktop and several times that on a phone. The
number nobody could justify was the render loop's, not the product's. The
scrollback is memoised now, the cap is 1500, and the page size is set by what is
useful. When a constant looks arbitrary, find out what is actually holding it
down before arguing about the value.

**Time runs down the screen, once.** `Terminal` sets `scrollTop = scrollHeight`
after every command, so the view lands on the **last line printed**, not the
first. Anything time-ordered must therefore print oldest-first, or the screen
fills with the oldest items and the newest scroll away above — which is the
opposite of what `order by created_at desc limit 30` was asking for. Fetch
newest-first, print oldest-first: `oldestFirst()` in `lib/shell/render.ts`, and
`lib/shell/order.test.ts` pins all five surfaces. This was wrong in five places
at once for the whole of the project's life, because every renderer was checked
for *what* it printed and none for the order.

**Mobile is the kill condition** (§8). Every e2e test runs at 380×740 and there
is no desktop project. Measure what a thumb can reach — `.tap()` scrolls an
element into view first, which is how an off-screen chip passed a green suite.

**A source-reading test must strip comments first.** Several guards here check
the shape of code rather than its behaviour, because the failure they catch is
invisible to anything that runs — a PostgREST embed, a redirect origin, a
caching service worker. Every one of those files explains the bug it used to
have, quoting the broken expression, and a raw text scan makes that explanation
fail the check for the thing it explains.

It has now happened four times, and the fourth is the one worth reading. The
rule had been applied to the TypeScript half of `lib/data/rpc.test.ts` and not
to the SQL half, so a `--` comment sitting inside a parameter list —

```sql
create or replace function public.create_room (
  p_slug  citext,
  p_gloss text,
  -- Where the person was standing.
  p_from  citext default null
)
```

— was split on the comma with the rest of that line and read as a parameter
called `--`. `p_from` vanished, the scanner fell back to the older
two-parameter signature, and the test reported a *correct* call site as wrong.
A comment near the thing you match is not an edge case; it is where the
reasoning lives in this codebase. Strip `/* */` and `//` on the TypeScript
side and `/* */` and `--` on the SQL side, before matching, in every scanner —
both halves, not the one that broke.

**`request.url` is not the address anybody typed.** Behind a proxy — Netlify,
here — a route handler sees an internal deploy URL. Reading the query string off
it is fine, since parameters survive the rewrite untouched; taking `.origin` and
redirecting somebody there is not, and that is how a magic link that said
`thewall.social` in the email landed on a `netlify.app` host nobody had
configured. Redirect with a **relative** `Location` and the question cannot
arise. If you ever do need an absolute one, `siteUrl(request)` in
`lib/auth/links.ts` resolves it against origins the platform vouches for.

**A redirect target that came from the query string is an open redirect until
you check it.** `new URL(next, origin)` returns `https://evil.example` for
`?next=https://evil.example`, and `//evil.example` is a URL wearing a path's
clothes. Both spellings, every time.

**A second foreign key to the same table breaks every PostgREST embed to it.**
`author:profiles(name)` resolves by looking for *the* foreign key between the
two tables. One key, one answer; two keys and PostgREST refuses the whole query
rather than guessing — so the symptom is not a missing field, it is no data at
all on every request that runs it. Adding `rooms.created_by` beside
`rooms.owner_id` did exactly that and took the site down. Nothing in any suite
could see it: e2e runs on fixtures, and `test:db` talks to Postgres directly and
never goes near PostgREST. `lib/data/embeds.test.ts` reads the query strings out
of the source and checks them against the migrations instead. When you add a
foreign key, name the constraint in every embed to that table:
`profiles!rooms_owner_id_fkey(name)`.

**Column-scope INSERT too, not just UPDATE.** A row policy answers "whose row
is it" and says nothing about which columns. That was fixed for UPDATE early and
left open on INSERT for months, where it was the same hole: the row's *first*
write is still a write. Before granting a browser INSERT on anything, ask which
columns it actually needs — and whether it needs the grant at all, since the
signup route uses the service role and did not need the one it had.

**A room that holds nothing renders as an empty one, on every surface you
forget.** `feed` has no posts of its own — it shows what is on the walls — so
anything that draws a room from `room.posts` draws it empty and says "nothing
here yet, say something and it will be the first thing", which is wrong twice
over. `go feed` was special-cased first and four other surfaces were not: the
URL (`arriveAt`), the lobby line (`room_overview` and `fixtureEnv.listRooms`),
the share card, and the count in `find --rooms`. When something is a view rather
than a container, walk all five.

**The fixture Env must not lie.** The e2e suite runs entirely against
`fixtureEnv`, so a fixture that disagrees with the database is a green suite
over a broken site — not a smaller problem than a bug, a bigger one, because it
also removes the thing that would have told you. This has bitten once already:
`search_said` covered replies while the fixture did not, which made "find
reaches replies" a claim proved only in `test:db` and false in the app anybody
clicked. `lib/commands/rooms.test.ts` has a block that exists purely to pin the
two together; add to it when you add behaviour to one side.

**A derived flag is not the same as the fact it approximates.** `rooms.curated`
started as `created_by is null`, which is identical until `created_by` is
nulled — and it is `on delete set null`, so erasing whoever opened a room would
have promoted it to permanent lobby furniture nobody chose. If two questions can
ever diverge, they get two columns.

**A wall is a room with an owner, and the lobby never shows one.**
`room_overview` filters `owner_id is null`. That single filter is the whole of
§4.2's mitigation; without it a room-per-person is exactly the forty-rooms
failure the doc warns about.

---

## Before you push

```bash
npm test && npm run test:e2e && npm run test:db && npm run build
```

All four, every time. They cover different things and each has caught something
the others could not: the unit suite catches wording and shape, e2e catches
layout and anything involving a real browser, `test:db` catches every claim
about what the database enforces, and `build` catches the type errors that only
appear under Next's compiler.

`npm run dev:demo` and an actual phone is the fifth suite, and the only one that
can answer §4.5.
