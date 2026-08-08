-- The daily email is on unless you turn it off.
--
-- The previous migration argued the other way and named the reason: §4.1 leans
-- "pull-only, no push, no email", and consent was how both halves of that were
-- kept. What that argument missed is the sentence directly above it in the same
-- section — notifications are the *highest-priority unsolved item*, because "no
-- notification means no reason to return".
--
-- An opt-in notification does not solve that, and cannot. The people who type
-- `notify on` are the people already coming back; they are the ones who least
-- need reminding. Everybody else — the person who said one thing, got a good
-- answer three days later, and never found out — is exactly who the feature is
-- for, and an opt-in never reaches them. A default is not a detail here. It is
-- the whole of whether the feature does its job.
--
-- WHAT THIS IS NOT
--
-- It is not permission to email anybody. Every guard the opt-in version had is
-- still here, and they are the reason defaulting on is defensible rather than
-- rude:
--
--   * `pending_digests` still requires `verified_at is not null`, so nothing is
--     sent to an address until somebody has followed a key that arrived in it.
--     A stranger whose address was typed into a signup box gets one key and
--     never hears from this site again. That is the guard that matters most and
--     it is untouched.
--   * Still at most one a day, and only on a day somebody actually answered
--     you. A quiet week is a silent week.
--   * Still stopped by `notify off`, by the link at the bottom of every one, and
--     by the one-click header mail clients read without opening anything.
--   * Still nothing else, ever. There is no second kind of email to be enrolled
--     into later.
--
-- HOW OFF STAYS OFF
--
-- The one thing a default flip must never do is re-enable somebody who turned
-- it off. It cannot here, and not by being careful: `set_notify(false)` writes a
-- row with `daily = false` rather than deleting one, and `unsubscribe` does the
-- same. So "off" is a stored fact, and "never touched it" is the absence of a
-- row. Only the second becomes on.
--
-- Every profile gets a row from now on, made by a trigger rather than by the
-- signup route, because a route is a thing somebody can add a second copy of
-- and a trigger is not. Existing profiles are backfilled below.

alter table public.notify_settings
  alter column daily set default true;

comment on column public.notify_settings.daily is
  'On by default. False only because somebody said so — notify off, or the link '
  'in an email. The absence of a row is not "off"; see the trigger below.';

-- A row for everybody, from the moment there is somebody --------------------
--
-- On `profiles` rather than `auth.users`: a profile is what this site means by
-- a person, it is what `notify_settings` references, and `auth.users` is a
-- schema owned by somebody else that this project should not be hanging
-- triggers off.
create or replace function public.notify_default ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `on conflict do nothing` rather than an upsert. If a row somehow exists
  -- already, it holds a decision, and a decision beats a default.
  insert into public.notify_settings (profile_id)
  values (new.id)
  on conflict (profile_id) do nothing;
  return new;
end;
$$;

drop trigger if exists profiles_notify_default on public.profiles;
create trigger profiles_notify_default
  after insert on public.profiles
  for each row execute function public.notify_default ();

-- The backfill ---------------------------------------------------------------
--
-- Everybody who already had an account and never touched the setting. They have
-- no row, so this gives them one, on.
--
-- This is the only genuinely awkward statement in the file, and it is worth
-- being plain about why: these people signed up while the privacy policy said
-- the summary was "off unless you type notify on". That promise is being
-- changed under them. It is defensible — the mail is about replies to their own
-- posts, it is capped at one a day, and it carries a one-click stop — and it is
-- still a change to something they were told.
--
-- If that trade is ever the wrong one (a project with real people on it, rather
-- than one that has not launched), delete this statement and keep the rest. New
-- accounts are then on by default and existing ones are untouched, which is the
-- conservative version of the same change.
insert into public.notify_settings (profile_id, daily)
select p.id, true
  from public.profiles p
 where not exists (
   select 1 from public.notify_settings n where n.profile_id = p.id
 )
   -- Not the erased. `forget` deletes their row on purpose, and re-creating one
   -- here would undo an erasure with a backfill — the exact shape of bug that
   -- migration was written to prevent.
   and p.banned_at is null
on conflict (profile_id) do nothing;

-- Reading your own setting ----------------------------------------------------
--
-- The fallback flips with the default. It should be unreachable now that every
-- profile has a row, and it is written correctly anyway: a `coalesce` that
-- still said `false` would be a second, quieter answer to the same question,
-- and the two would disagree for exactly the accounts nothing else covers.
create or replace function public.notify_state ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select daily from public.notify_settings where profile_id = auth.uid ()),
    true
  );
$$;

revoke all on function public.notify_state () from public, anon;
grant execute on function public.notify_state () to authenticated;

-- Turning it on, when it is already on ----------------------------------------
--
-- Unchanged in behaviour and recreated for one line of comment, because the
-- verified check now reads oddly and the reason it stays matters.
--
-- `set_notify(true)` still refuses an unverified account. That looks redundant
-- when the default is on — but the default is a row in a table, and the thing
-- that actually decides whether mail is sent is `pending_digests`, which
-- requires `verified_at`. Somebody unverified is therefore "on" and receiving
-- nothing, which is the correct state and a confusing one to be told about. The
-- refusal is how they find out, in a sentence that names the fix.
create or replace function public.set_notify (p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_verified timestamptz;
begin
  if auth.uid () is null then
    raise exception 'you have to be signed in for that.';
  end if;

  select verified_at into v_verified from public.profiles where id = auth.uid ();

  if p_on and v_verified is null then
    raise exception 'follow the link in your email first — then i can send you things.';
  end if;

  insert into public.notify_settings (profile_id, daily)
  values (auth.uid (), p_on)
  on conflict (profile_id) do update set daily = excluded.daily;

  return p_on;
end;
$$;

revoke all on function public.set_notify (boolean) from public, anon;
grant execute on function public.set_notify (boolean) to authenticated;
