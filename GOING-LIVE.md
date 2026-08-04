# Going live

Everything in this file is configuration, not code. The code is done and tested;
what is left is pointing it at real services and checking that the parts which
have never executed against a real project actually do.

Work top to bottom. Each step says how to tell it worked, because several of
these fail silently — the site keeps loading and one feature is quietly dead.

---

## 1. The database

Your project was set up when there were three migrations. There are now eight.
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

**Worked when:** the site loads and shows the five rooms rather than
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

## 6. Check the two documents before anyone reads them

`/terms` and `/privacy` are written and tested, but two things in them are
placeholders in all but name:

- **Governing law.** The terms currently say England and Wales. If you are in
  the US, that clause should name your state.
- **The contact address.** `hello@thewall.social`, per step 5.

Both are one edit in `lib/legal/documents.ts`.

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

## 8. Know how to turn it off

Before anyone else is on it, run these once so they are not new to you at 2am:

```bash
DATABASE_URL='...' ./scripts/moderate.sh who
DATABASE_URL='...' ./scripts/moderate.sh look <yourname>
```

The levers are `ban`, `hide`, `close` and `forget` — everything except `forget`
is reversible, and `forget` asks before it runs. `./scripts/moderate.sh` with no
arguments lists them.

---

## Still deliberately not done

- **§4.6's reserved names.** Renaming releases the old handle immediately, by
  your call. The guard is disclosure: a name that changed hands recently says so
  on the profile of whoever holds it now.
- **Backups.** Supabase's own are whatever your plan includes. Nothing here adds
  to them, and the terms say so rather than implying otherwise.
- **Anything §4.2, §4.3 and §6 argue for leaving out** — user-created rooms,
  threading, private messages, personal walls.
