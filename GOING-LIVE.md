# Going live

Everything in this file is configuration, not code. The code is done and tested;
what is left is pointing it at real services and checking that the parts which
have never executed against a real project actually do.

Work top to bottom. Each step says how to tell it worked, because several of
these fail silently — the site keeps loading and one feature is quietly dead.

---

## 1. The database

Your project was set up when there were three migrations. There are now eleven.
The five that came after add: the column-scoped grants that close two console
bypasses, mail, the kill switch, rename, and erasure. **None of their features
work until they are applied**, and none of them fail at build time — they fail
in somebody's browser.

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

This is safe to run repeatedly now. On its first run against an existing project
it probes for each migration, records the ones already there, and applies only
the rest — nothing runs twice and nothing is skipped.

**Worked when:** `db-check.sh` shows all eight as `applied`, every room has
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

`NEXT_PUBLIC_*` values are compiled into the browser bundle **at build time**.
Adding one changes nothing until you redeploy. Set them first, then deploy.

If `NEXT_PUBLIC_USE_FIXTURES` is set anywhere, remove it — it serves the demo
content and writes nothing.

**Worked when:** the site loads and shows the six rooms rather than
"thewall needs a supabase project."

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

**Worked when:** step 7's magic link signs you in instead of showing an error.

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

**Worked when:** step 7 puts a real email in a real inbox.

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
4. **Check the inbox.** The key should be there. Click it. You come back signed
   in and verified.
5. `say something else` — this only works if step 4 actually worked. If it says
   "check your email", verification did not land.
6. Open a second browser, sign up as somebody else, reply to your post.
7. Back in the first: `mail` should show the reply with its `room/id`, and the
   count line should appear above the prompt. **This is the one that was broken
   until just now** — `mailCount` was declared, threaded through and never set,
   so the count never polled. Worth confirming.
8. `rename something_else`, then `~something_else` in the URL.
9. `theme black`, reload, still black.
10. In commons, with both browsers open: say something in one and watch it
    appear in the other without a refresh.

Anything that fails here fails in a way no test could have caught, which is
exactly why the walk exists.

---

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
