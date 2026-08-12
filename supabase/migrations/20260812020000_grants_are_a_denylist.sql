-- Two holes, one root: every grant so far has been written as though the
-- database started with none.
--
-- A Supabase project runs `alter default privileges in schema public grant all
-- on tables to anon, authenticated` before any of this ever executes. So each
-- `create table` here is born with INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES and TRIGGER already granted to the two roles the browser can
-- assume, and the careful `grant select on ...` lines added nothing — they
-- restated a privilege the table already had.
--
-- None of that showed up in the test suite, because the suite runs on plain
-- Postgres, where a new table has no grants at all. Every assertion about
-- grants passed by measuring a database shaped differently from the one this
-- ships to. `supabase/tests/_shim.sql` now sets the same default privileges,
-- which is what turned this up.
--
-- What was actually reachable:
--
--   * `truncate public.posts cascade` as **anon**. Row-level security does not
--     apply to TRUNCATE — there is no row to filter — so the policies that hold
--     every other write are simply not consulted. Verified: 21 posts before,
--     0 after, from a role holding nothing but the publishable key. It is not
--     reachable through PostgREST today, which speaks SELECT/INSERT/UPDATE/
--     DELETE and no more, but "the API happens not to expose the verb" is not a
--     control, and it costs nothing to stop relying on it.
--
--   * INSERT, UPDATE and DELETE for **anon** on posts, profiles, replies,
--     rooms, reserved_slugs and name_history. Those *are* reachable, and they
--     held — but they held on RLS alone, with the grant layer contributing
--     nothing. `20260804000000` and `20260805050000` both exist because one
--     layer holding by itself is how the last two bypasses happened.
--
--   * `require_can_contribute(uuid)` callable by any signed-in account, though
--     its migration says `revoke ... from public, anon` — the revoke named the
--     one role the default privileges had not granted to.
--
-- The fix inverts the posture. Privileges for anon and authenticated are taken
-- away wholesale and then handed back by name, and the default privileges are
-- turned off so the next `create table` starts empty. From here a migration
-- that forgets to grant produces a visibly broken feature; before, one that
-- forgot to revoke produced a silently open table.

-- Everything, gone -------------------------------------------------------------
--
-- **This takes the column-scoped grants with it.** `revoke all on <table>`
-- removes that grantee's column privileges as well as the table-level ones,
-- which is not what the wording suggests and is worth stating because getting
-- it wrong here does not look like a permissions bug: `rooms` becomes
-- unreadable, and the first symptom is that reading a *post* fails, because the
-- policy on `posts` calls `is_visible()`, which reads `rooms` as the caller.
-- Nothing anywhere says the word "rooms". The column list is restored below.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- And no new object arrives armed. Anything created in `public` after this
-- lands with nothing granted to the two browser roles.
--
-- This matches the role that runs the migration, which is `postgres` both for
-- `scripts/db-deploy.sh` and for the SQL editor. A project whose migrations
-- were applied as some other role keeps that role's defaults, so the
-- assertions in `supabase/tests/schema.test.sql` check the resulting grants
-- rather than the default-privilege rows themselves.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Reading, handed back ---------------------------------------------------------
--
-- §3.9: reading is anonymous and asks for nothing, so both roles read the same
-- five relations. `rooms` is deliberately absent — the lobby reads
-- `room_overview`, and the columns anon may see on the table itself are granted
-- one by one in `20260805000000_user_rooms.sql`.

grant select on public.posts, public.replies, public.profiles,
                public.reserved_slugs, public.room_overview
  to anon, authenticated;

-- `rooms` by the column, restoring what the revoke above took. The list is the
-- one from `20260806020000_rooms_grew_out_of.sql` and the omission is the
-- point: `created_by` is not in it, so who opened a room stays unreadable
-- (§4.2 — a room has no owner, and that has to be true of the data, not only of
-- the interface). The assertion in `supabase/tests/schema.test.sql` names
-- `created_by` directly, so a future column added to this list by habit is
-- caught rather than inherited.
grant select (
  slug, gloss, ephemeral, sort_order, next_post_no, created_at,
  owner_id, archived_at, hidden_at, curated, from_room
) on public.rooms to anon, authenticated;

-- And the two columns `replies` gained after its table-level grant was written.
-- Covered by the table grant above; restated so that removing the table grant
-- one day does not silently un-address every reply.
grant select (reply_no, to_reply_no) on public.replies to anon, authenticated;

-- Writing, handed back ---------------------------------------------------------
--
-- Nine functions, and no table. Every write in this product goes through a
-- `security definer` function that decides for itself whether the caller has
-- earned it; the tables take no writes from a browser at all. The list is
-- closed on purpose — a tenth function is a line in this file, which is the
-- point of writing it out rather than looping over `pg_proc`.

grant execute on function public.change_name (citext) to authenticated;
grant execute on function public.create_post (citext, text) to authenticated;
grant execute on function public.create_reply (citext, integer, text, integer) to authenticated;
grant execute on function public.create_room (citext, text, citext) to authenticated;
grant execute on function public.mail () to authenticated;
grant execute on function public.mail_count () to authenticated;
grant execute on function public.mark_mail_seen () to authenticated;
grant execute on function public.notify_state () to authenticated;
grant execute on function public.set_notify (boolean) to authenticated;

-- Verification is not something you may award yourself ---------------------------
--
-- `mark_verified()` took no arguments, marked `auth.uid()`, and was granted to
-- `authenticated`. Every one of those is defensible on its own and together
-- they hand out the §4.7 gate for free:
--
--   await supabase.rpc('mark_verified')
--
-- from the console of anyone signed in. And everybody is signed in from the
-- moment they pick a name — that is the whole of §3.9, and `/api/signup`
-- creates the account with `email_confirm: true` so the session can start
-- before the inbox is ever opened. So the one control standing between "typed
-- an address" and "may post without limit" was a function the browser was
-- allowed to call and that asked for no proof.
--
-- `20260804000000` moved this behind an RPC to close a table-wide UPDATE grant,
-- and its comment says "auth.uid() means a caller can only ever mark
-- themselves". That is true and it is the wrong question. The gate is not about
-- *which* row gets marked; it is about whether anybody read the email.
--
-- Now the caller says who, and only the service role may call it. That role
-- exists only on the server, and the two places that use it — `/auth/callback`
-- and `/api/login/code` — have both just watched a token minted for that
-- address be spent, which is the claim §4.7 actually wants.

drop function if exists public.mark_verified ();

create or replace function public.mark_verified (p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then
    raise exception 'mark_verified needs a user' using errcode = 'null_value_not_allowed';
  end if;

  update public.profiles
     set verified_at = now()
   where id = p_user
     and verified_at is null;
end;
$$;

revoke all on function public.mark_verified (uuid) from public, anon, authenticated;
grant execute on function public.mark_verified (uuid) to service_role;
