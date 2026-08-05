-- The half of the column-scoping fix that was missed.
--
-- `20260804000000_column_scoped_grants.sql` closed this on UPDATE: a table-wide
-- grant beside a row policy means the policy answers "whose row is it" and
-- nothing answers "which columns may change", so anybody could set their own
-- `verified_at` and walk through the §4.7 gate.
--
-- INSERT was left table-wide, and it is the same hole. `profiles` has
-- `grant insert to authenticated` with a policy that checks only
-- `id = auth.uid()`, so a session with no profile row yet can create one with
-- **any column set**:
--
--   insert into profiles (id, name, verified_at, terms_accepted_at)
--   values (auth.uid(), 'attacker', now(), now())
--
-- and that account is verified without an inbox, may make rooms, and carries a
-- consent record it wrote itself. Verified against a real database before this
-- was written: `may_contribute` returned true immediately afterwards.
--
-- A session with no profile row is reachable. This app always creates the row
-- server-side under the service role, but the anon key can talk to GoTrue's own
-- signup and OTP endpoints directly, and those make a user and no profile.
--
-- I claimed in a commit message that the terms record "cannot be forged from a
-- browser, because there is no UPDATE grant on profiles". That was true of
-- UPDATE and false of the row's first write.

-- profiles ---------------------------------------------------------------------
--
-- Revoked outright rather than column-scoped. Nothing in the client inserts a
-- profile: signup does it through `createAdminClient()`, which is the service
-- role and bypasses grants entirely. A grant nothing uses is a grant that only
-- an attacker can find a use for.
revoke insert on public.profiles from authenticated;

-- replies ----------------------------------------------------------------------
--
-- This one is genuinely used by the client — `writer.ts` inserts
-- `{post_id, author_id, body}` — so it is scoped to exactly those three rather
-- than revoked.
--
-- What the table-wide version also allowed, both quieter than the profiles hole
-- and both real:
--
--   * `created_at` in the future. §4.1 counts a reply as unread while
--     `created_at > mail_seen_at`, so a reply dated next year sits in somebody's
--     inbox permanently and reading it does not clear it.
--   * `created_at` in the past, which reorders a thread: §4.3 sorts replies
--     chronologically, so a chosen timestamp puts your answer above answers
--     written before it.
--   * `hidden_at`, which is the operator's column and not a writer's.
revoke insert on public.replies from authenticated;
grant insert (post_id, author_id, body) on public.replies to authenticated;

-- The policy is unchanged and still does its half: `author_id = auth.uid()` and
-- the post has to be readable. Columns and rows are two different questions and
-- this schema now answers both on every table a browser can write to.
