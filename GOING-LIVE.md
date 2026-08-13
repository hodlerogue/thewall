# Going live

Everything in this file is configuration, not code. The code is done and tested;
what is left is pointing it at real services and checking that the parts which
have never executed against a real project actually do.

Work top to bottom. Each step says how to tell it worked, because several of
these fail silently — the site keeps loading and one feature is quietly dead.

---

## 1. The database

Your project was set up when there were three migrations. There are now
twenty-five. What the rest add: the column-scoped grants that close two console
bypasses, mail, the kill switch, rename, erasure, walls, rooms people make, the
feed, three more rooms, the daily email, rooms that grew out of a room, that
email being on by default, never mailing an address that cannot receive, a
lobby that uses its index, replies you can answer, posts with paragraphs in
them, `hello` reserved so the landing page cannot shadow a room, and the grant
sweep below. **None of their features work until they are applied**, and none of
them fail at build time — they fail in somebody's browser.

**The two to apply first, if you apply nothing else.** Both are security fixes,
and both are invisible until somebody goes looking.

`20260805050000_insert_grants.sql` — without it a browser can insert rows into
`profiles` directly, verified column and all.

`20260812020000_grants_are_a_denylist.sql` — two things. It stops any signed-in
account marking *itself* verified with one line from the browser console, which
was the whole of the §4.7 gate; and it takes back the privileges a Supabase
project grants to `anon` and `authenticated` on every new table before a
migration ever runs. Those included TRUNCATE, which row-level security does not
filter — so `truncate posts cascade` from the publishable key emptied the site.
Nothing in the app used the verb and PostgREST does not speak it, which is why
this was survivable, but it was one grant away from not being.

> Applying it changes what the browser may do, so it is worth checking after.
> Load the site signed out and read a room: if posts render, the column grants
> landed. Then follow a magic link and confirm the §4.7 gate opens — that path
> now runs `mark_verified(uuid)` under the service role, so it needs
> `SUPABASE_SERVICE_ROLE_KEY` set on the deploy, which §2 covers.

Find out what you actually have:

```bash
DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
  ./scripts/db-check.sh
```

The connection string is **Project Settings → Database → Connection string →
URI**. It contains your database password.

Then apply what's missing:

```bash
DATABASE_URL='...' ./scripts/db-deploy.sh
```

**No psql, or a brand new project?** `supabase/setup.sql` is every migration and
the seed in one file, generated from the same directory `db-deploy.sh` walks.
Open it, copy it, and paste it into **SQL Editor → New query → Run**. There is
nothing to fill in. It lands in one transaction, so a paste that fails partway
leaves the project untouched rather than half-built.

Use it only on a project with nothing in it. Against one that already has the
schema it fails on the first `create table` and rolls back — correct, but
`db-deploy.sh` is the tool there, since it applies only what is missing.

**Moving to a different Supabase account?** `scripts/db-move.sql` carries the
accounts, rooms, posts, replies, released names and email opt-ins across. Run
`setup.sql` on the new project first; the move file explains the rest and ends
with a check you run on both sides. Two things it will tell you and are worth
knowing going in: everybody is signed out by the move, because the new project
mints its own JWT secret and they come back with `login <name>`; and commons is
not carried, because commons keeps nothing.

This is safe to run repeatedly now. On its first run against an existing project
it probes for each migration, records the ones already there, and applies only
the rest — nothing runs twice and nothing is skipped.

**Worked when:** `db-check.sh` shows all twenty-four as `applied`, every room has
something in the last two columns, and the anon role reads all five objects.

---

## 2. Netlify environment

**Site configuration → Environment variables.** These must exist:

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon key | public by design; RLS decides what it reads |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role key | **server only** — bypasses every policy |
| `NEXT_PUBLIC_SITE_URL` | `https://thewall.social` | where the magic link comes back to |
| `RESEND_API_KEY` | from Resend | leave blank and keys go to the server log instead |
| `MAIL_FROM` | `thewall <key@thewall.social>` | must be a verified domain at Resend |
| `DIGEST_SECRET` | a long random string | leave it unset and the daily email route is **off**, not open |

`NEXT_PUBLIC_*` values are compiled into the browser bundle **at build time**.
Adding one changes nothing until you redeploy. Set them first, then deploy.

If `NEXT_PUBLIC_USE_FIXTURES` is set anywhere, remove it — it serves the demo
content and writes nothing.

**Worked when:** the site loads and shows the rooms rather than
"thewall needs a supabase project."

---

## 2a. The daily email, if you want it at all

Nothing here is required. With no `DIGEST_SECRET` the route answers 503 and no
email is ever sent — which is a working deployment, just one where the setting
records a preference nothing acts on.

**Accounts are opted in; the site is not.** Every account is on from the moment
it exists and off the moment somebody types `notify off`. Nothing actually goes
out until you schedule the job below, so the site-wide switch is this section
and the per-person one is theirs.

Three things bound it, and they are why on-by-default is defensible rather than
rude. Nothing is sent to an address until somebody has followed a key that
arrived in it, so a stranger whose address was typed into a signup box gets one
key and never hears from this site again. It is at most one a day, only on a day
somebody actually answered them. And every one carries both a visible link and
the RFC 8058 header a mail client can act on without opening anything.

If you would rather existing accounts were left alone and only new ones default
on, delete the backfill statement in
`20260808000000_notify_on_by_default.sql` before applying it — the file says
which one and why.

Point any scheduler at it once a day:

```
curl -fsS -X POST https://thewall.social/api/digest \
  -H "authorization: Bearer $DIGEST_SECRET"
```

A POST, and with a secret, on purpose. A GET that sends mail is one crawler
away from sending it twice, and link prefetchers follow GETs.

It answers `{"sent":N,"due":M}`. `due` is who had something waiting; `sent` is
who the provider accepted. Only the ones actually sent to are stamped, so a
provider outage costs one run rather than everybody's day.

**Pick a civilised hour.** It sends in one burst, and the timestamp people see
is whenever you scheduled it. Something like 17:00 in the timezone most of them
are in.

**Worked when:** running it by hand answers `{"sent":0,"due":0}` on a quiet
site, and `401` without the header.

---

## 3. The domain

Point `thewall.social` at Netlify (**Domain management → Add a domain**), and
let it issue the certificate. Until this is done, `NEXT_PUBLIC_SITE_URL` should
stay as the `.netlify.app` origin — a magic link pointing at a domain that does
not resolve yet is worse than one pointing at an ugly URL.

**Worked when:** `https://thewall.social` loads over HTTPS with no warning.

---

## 4. Supabase redirect allowlist

**Authentication → URL Configuration.**

- **Site URL:** `https://thewall.social`
- **Redirect URLs:** add `https://thewall.social/auth/callback`

Without this the magic link is refused when it arrives, which reads to the
person clicking it as the link being broken.

**Worked when:** the walk's step 4 link signs you in instead of showing an error.

---

## 5. Email

Resend needs `thewall.social` verified before it will send from it: **Domains →
Add domain**, then add the DNS records it gives you (SPF, DKIM, and it will ask
for a return-path record too).

Until that is verified, `MAIL_FROM` cannot use the domain and sending fails —
the app handles this without breaking (`resend` in the prompt says the address
did not take the mail), but nobody can verify an account, which means everybody
is stuck after one post.

Also set up `hello@thewall.social` to actually receive mail. Both published
documents name it as the way to make an access, correction or deletion request,
and an address in a privacy policy that bounces is worse than no address.

**Worked when:** the walk's step 4 puts a real email in a real inbox.

---

## 6. The governing law — set, and worth checking once

**Set to Arizona.** `jurisdiction()` in `lib/legal/documents.ts` returns the law
of the State of Arizona and its courts, and the "not set yet" notices that used
to appear on `/terms` and in the `terms` command are gone automatically.

It names a **state**, not the country, and that is not a formality: contract and
consumer law in the US is state law, so "governed by the laws of the United
States" names nothing a court could apply. A test now refuses a bare federal
country name for exactly that reason. Canada names a province; most other places
the country is enough.

The clause is about **where you are** — not where visitors are. Somebody in the
UK using the site does not make UK law govern the terms. What protects them is
already written and unaffected by this: the privacy policy is written to the
GDPR, and the Law section preserves consumer rights that cannot be signed away,
including the right to bring a claim in their own local courts. So welcome UK and
EU visitors freely.

If you move, or if this was never right, change `law` and `courts` together —
they are one decision and a mismatched pair is worse than either.

While you are in that file: `CONTACT` is `hello@thewall.social`, which needs to
receive mail per step 5. That is now the only unfinished item in either document.

### How agreement is collected

Worth knowing before you launch, because it is the part people get wrong. There
is no checkbox — §6 rules out forms — so the terms are agreed to at the one
moment somebody deliberately makes an account: the prompt says so immediately
above the answer that creates it, and `terms` and `privacy` both work from
inside that question. `profiles.terms_accepted_at` and `terms_version` are
written by the signup route under the service role.

**If you change the terms, change `LAST_UPDATED` in the same edit.** New accounts
record whichever string is there, so leaving it stale means the record says
people agreed to a version that was already gone.

---

## 7. Walk it once, on a phone

None of this has run against a real Supabase project. The suites cover fixtures,
schema and layout — they cannot cover PostgREST, GoTrue or Resend. So the last
step is fifteen minutes of doing it by hand, on a phone, because §8 makes mobile
the kill condition.

1. Open `thewall.social` in a private window. You should land in commons and be
   able to read everything without being asked anything.
2. `go music`, `go 12` — the post and its replies.
3. `say something` — it asks for a name, then an email, then posts the sentence
   you already typed without you retyping it.
4. **Check the inbox.** The key should be there — a short code first, and a
   link below it. Click the link. You come back signed in and verified.
5. `say something else` — this only works if step 4 actually worked. If it says
   "check your email", verification did not land.
6. **Now the code, which is the half no suite can reach.** In a *new* private
   window: `login <that name>`, then type the six characters from the email at
   the prompt. It should say "you're <name> again" and the prompt label should
   change without the page moving.

   This is the step that matters most on a phone, and the one to be most
   suspicious of. Everything else in this walk has been exercised by fixtures;
   `verifyOtp({ email, token, type: 'magiclink' })` has never run against a real
   GoTrue from this codebase. If the code is refused while the link in the same
   email works, the `type` is the thing to change — try `'email'`.

   Then try the same thing the way it actually gets used: open the email in the
   Gmail app, tap the link, and confirm you end up signed in *inside Gmail* and
   still a guest in Safari. That is the bug this exists for, and it should still
   be true — nothing here fixes the link, it just stops the link being the only
   door.
7. Open a second browser, sign up as somebody else, reply to your post.
8. Back in the first: `mail` should show the reply with its `room/id`, and the
   count line should appear above the prompt. **This is the one that was broken
   until just now** — `mailCount` was declared, threaded through and never set,
   so the count never polled. Worth confirming.
9. `rename something_else`, then `~something_else` in the URL.
10. `theme black`, reload, still black.
11. In commons, with both browsers open: say something in one and watch it
    appear in the other without a refresh.
12. `make` a room from inside another room, then walk back into the first: it
    should list the new one at the bottom as having grown out of it.

Anything that fails here fails in a way no test could have caught, which is
exactly why the walk exists.

---

## Adding it to a phone

Nothing to configure — the manifest and the icons are generated by the build,
and `public/sw.js` is served as a static file. Two things worth knowing:

- **It needs HTTPS**, which the deploy already has. On plain http a browser will
  not register the worker and will never offer to install, and both fail
  silently.
- **Chrome decides when a site is eligible** and fires the event on its own
  schedule. `install` before that lands falls back to naming the browser menu,
  which is also what every non-Chrome browser gets. On iOS there is no API at
  all and there never has been, so it prints the two taps instead.

Check it with `doctor`'s build line first if it seems not to be offering: a
manifest change needs a deploy like everything else.

## When something is wrong

Type **`doctor`** at the prompt. It is hidden — it is not in `help` and nobody
arriving needs it — and it reports the things that otherwise cannot be told
apart from each other:

```
  build            7bf4c9a on main          ← is the fix even deployed?
  here             https://thewall.social
  site url         https://thewall.social   ← a mismatch breaks the magic link
  session          signed in
  name             jameson
! verified         no — the key was never recorded
  ...verify_to_continue     applied
! ...mail                   NOT APPLIED
```

The build line is the one that matters most. A code bug, an unapplied
migration, and "that is not deployed yet" all present as the same sentence on
screen, and without this there is nothing on the page that separates them.

`site url` deserves its own look: `NEXT_PUBLIC_SITE_URL` is where the magic
link comes back to, and the session cookie belongs to whichever host the
callback ran on. If it says `thewallsocial.netlify.app` while you are reading
`thewall.social`, following a key signs you in on the other origin and leaves
you a guest on this one.

### "I changed the share card and X is still showing the old one"

Expected, and there is nothing to fix in the code. X caches a scrape for about
a week, keyed on the URL, and the Card Validator that used to force a refresh
was retired in 2022 — there is no public way to purge it. Deleting the post
that showed the old card does not clear it either.

Two things that do work:

- **Share it once with a query string** — `thewall.social/?v=2`. X has never
  seen that URL, so it scrapes it fresh, and the redirect carries the query
  through to commons. Any word will do; it is thrown away by the app.
- **Wait.** The bare domain re-scrapes on its own once the entry expires.

Deliberately absent, and worth not adding by mistake: an `og:url` tag. It tells
a crawler the canonical address of the page, which would let X fold `?v=2`
straight back into the cached entry for the bare domain — turning the one
workaround that exists into another way of seeing the old card.

What is on our side of the line is already done. The image sits at a new path
with a fresh content hash, so a crawler that does re-fetch cannot be handed the
old bytes; and `/` redirects to commons, so **commons serves the fixed card** —
without that, the poster is not what a link to the domain previews as at all.
See `lib/brand/og.test.ts` and `e2e/share-card.spec.ts`, which walk the
redirect the way a crawler does and compare the bytes.

### "The link says my domain, but following it lands on netlify.app"

A different fault from the one below, with the same result. The callback used
to build its redirect from `request.url`, and inside a route handler on Netlify
that is the **internal** deploy URL rather than the address the person typed —
so a key that correctly said `thewall.social` bounced to a deploy-scoped
`…--site.netlify.app` host that appears in no configuration anywhere, and the
session cookie was set over there.

Fixed in the code: the callback now sends a **relative** `Location`, which
cannot name the wrong host because it never names one. Nothing to configure. If
you are still seeing it, you are on a build from before that fix — check
`doctor`'s build line.

### "I signed up, followed the link, and it still doesn't know me"

All of these are the same fault, and it is `site url` above:

- the link in the email points at `*.netlify.app` and not your domain
- following it and coming back still asks what you want to be called
- `say` keeps answering "check your email to keep saying things"
- `resend` answers "this browser isn't signed in"

One cause: the key was sent to a different origin, so the session and the
verification both landed over there. Nothing is broken and nothing is lost —
the account exists, the name is yours.

**The fix:** set `NEXT_PUBLIC_SITE_URL` to the address people actually type,
then **redeploy** — it is a `NEXT_PUBLIC_` value, so it is baked in at build
time and changing it in the Netlify UI does nothing until the next build. Add
the same URL to Supabase under Authentication → URL Configuration → Redirect
URLs. Then `resend` from the real domain and follow that key.

The code prefers the origin a request actually came from, so long as Netlify
vouches for it (`URL`, `DEPLOY_PRIME_URL`), which fixes this on its own when
your custom domain is the site's **primary** domain rather than an alias. Set
the variable anyway — it is the fallback, and it is what `doctor` compares
against.

For the database side, `./scripts/db-check.sh` is the authoritative list.

---

### Dependencies, and the one that is pinned

`npm audit --omit=dev` is the check that matters — dev-only advisories are about
a build machine, not about anybody using the site. It should say zero.

Two are held there by `overrides` in `package.json` rather than by upgrading the
thing that pulls them in: **postcss** and **sharp** both arrive under `next`,
and both had high-severity advisories — sharp's are four libvips CVEs, and sharp
is what renders the share cards. The override takes the patched version without
moving the framework.

**`next` is pinned exactly, and that is deliberate.** Letting `npm install`
resolve `^16.2.12` picked up 16.3.0, which broke three signup assertions: a
magic link arriving at `/?key=ok` no longer reported anything, because the
outcome is read from the query after a redirect and 16.3 changed something about
that path. Nothing in this repo had changed. Upgrade it on purpose, with the
suites in front of you, not as a side effect of installing something else.

## 8. Know how to turn it off

Before anyone else is on it, run these once so they are not new to you at 2am:

```bash
DATABASE_URL='...' ./scripts/moderate.sh who
DATABASE_URL='...' ./scripts/moderate.sh look <yourname>
```

The levers are `ban`, `hide`, `close` and `forget` — everything except `forget`
is reversible, and `forget` asks before it runs. `./scripts/moderate.sh` with no
arguments lists them.

The same script opens a curated room — one that sits in the lobby permanently,
rather than fading when it goes quiet: `new-room <slug> <gloss>`, then `post-as
<room> <name> <body>` so it does not sit empty. That is the difference between
it and `make`, which anybody verified can now use: a room somebody makes lives
in the lobby only while people are talking in it. A room made either way is in
that database only — `CHANGING-IT.md` covers putting it in the seed as well.

**When you add a route under `app/`, add it to `reserved_slugs`** in the same
change, or somebody can take that name as a room and their room becomes
unreachable by URL.

---

## Still deliberately not done

- **§4.6's reserved names.** Renaming releases the old handle immediately, by
  your call. The guard is disclosure: a name that changed hands recently says so
  on the profile of whoever holds it now.
- **Backups.** Supabase's own are whatever your plan includes. Nothing here adds
  to them, and the terms say so rather than implying otherwise.
- **Anything §4.2, §4.3 and §6 argue for leaving out** — user-created rooms,
  threading, private messages.

Walls used to be on that list. They are built now, as rooms with owners
(`~name`), and the one thing they do not get is a line in the lobby — which is
where §4.2's "forty rooms with three people each kills the entire feeling"
actually applies. `scripts/moderate.sh` reaches them like any other room.
