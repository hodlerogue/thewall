-- One email a day, if you ask for it. Off for everybody until they do.
--
-- §4.1's lean was "pull-only, no push, no email", and it is decided differently
-- here for one reason: it also calls notifications the highest-priority unsolved
-- item, on the grounds that "no notification means no reason to return". Both
-- halves of that are true, and the way to keep them both is consent — nobody is
-- emailed who did not ask, and the people who did asked because they wanted a
-- reason to come back.
--
-- Everything lives in its own table rather than on `profiles`, and that is not
-- tidiness. `grant select on public.profiles` is table-wide, so a column added
-- there is readable by anyone with the anon key that ships in the browser
-- bundle. Three columns that must not be:
--
--   * the unsubscribe token — readable means anybody can unsubscribe anybody
--   * whether somebody gets email at all — nobody's business but theirs
--   * when they were last emailed — an activity trace on a site that publishes
--     a privacy policy saying it keeps none
--
-- So: a table with no grants and no policies, reached only through the
-- functions below. `profiles` stays exactly as public as it was.

create table if not exists public.notify_settings (
  profile_id  uuid primary key references public.profiles (id) on delete cascade,
  -- Off. Not "off unless", not "off for now" — the column default is the
  -- product decision, and a row only exists once somebody has chosen.
  daily       boolean     not null default false,
  -- The last time an email actually went out, which is what bounds this to one
  -- a day. Null means never.
  notified_at timestamptz,
  -- One per person, used in the link at the bottom of every digest. A uuid
  -- rather than the profile id, so possessing it proves nothing except that you
  -- were sent an email, and rotating it costs one update.
  token       uuid        not null default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

create unique index if not exists notify_settings_token on public.notify_settings (token);

-- The job asks "who is due", which is a scan by flag and time.
create index if not exists notify_settings_due
  on public.notify_settings (daily, notified_at)
  where daily;

alter table public.notify_settings enable row level security;

-- No policies and no grants, deliberately. Every read and write below is
-- `security definer`, so there is exactly one door into this table and the
-- rules are in one place rather than split between a policy and a function.
revoke all on public.notify_settings from anon, authenticated;

-- Turning it on --------------------------------------------------------------
--
-- Verified only. An address nobody has proved they can read is an address that
-- probably belongs to somebody else (§4.7 is the same argument for posting), and
-- the one thing worse than not sending a digest is sending one to a stranger
-- whose address was typed into a signup box.
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

-- Reading your own setting ----------------------------------------------------
create or replace function public.notify_state ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select daily from public.notify_settings where profile_id = auth.uid ()),
    false
  );
$$;

revoke all on function public.set_notify (boolean) from public, anon;
revoke all on function public.notify_state () from public, anon;
grant execute on function public.set_notify (boolean) to authenticated;
grant execute on function public.notify_state () to authenticated;

-- Who is due ------------------------------------------------------------------
--
-- The unread count here is `mail_count()`'s, filter for filter, and it has to
-- stay that way: an email saying "3 replies" that opens onto an empty `mail` is
-- worse than no email. The difference is only that this runs for everybody at
-- once rather than for `auth.uid()`, which is why it cannot simply call it.
--
-- Twenty hours rather than twenty-four. A daily job never fires at exactly the
-- same second, and at 24 a run four minutes early skips somebody for the whole
-- day. At 20 the worst case is an email slightly less than a day after the last
-- one, which nobody will notice, and it still cannot produce two in a day
-- unless the job itself is run twice.
create or replace function public.pending_digests ()
returns table (
  profile_id uuid,
  name       citext,
  email      text,
  unread     integer,
  token      uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.name,
         u.email::text,
         count(r.*)::integer,
         n.token
    from public.notify_settings n
    join public.profiles p on p.id = n.profile_id
    join auth.users u on u.id = p.id
    join public.posts po on po.author_id = p.id
    join public.rooms rm on rm.slug = po.room_slug
    join public.replies r on r.post_id = po.id
   where n.daily
     and p.banned_at is null
     and p.verified_at is not null
     and u.email is not null
     and (n.notified_at is null or n.notified_at < now() - interval '20 hours')
     -- The same three the badge uses: a reply under a hidden post, or in a
     -- closed room, is a notification pointing at nothing.
     and r.hidden_at is null
     and po.hidden_at is null
     and rm.hidden_at is null
     and r.author_id <> p.id
     and r.created_at > p.mail_seen_at
   group by p.id, p.name, u.email, n.token
  having count(r.*) > 0;
$$;

-- Stamped after the send, never before -----------------------------------------
--
-- Takes the ids that were actually sent to, rather than stamping everybody the
-- query returned. A provider outage would otherwise mark a day's worth of
-- people as notified and they would hear nothing until tomorrow.
create or replace function public.mark_digested (p_ids uuid[])
returns integer
language sql
security definer
set search_path = public
as $$
  with done as (
    update public.notify_settings
       set notified_at = now()
     where profile_id = any (p_ids)
    returning 1
  )
  select count(*)::integer from done;
$$;

-- Unsubscribing, with no session ------------------------------------------------
--
-- The link at the bottom of an email is followed on whatever device the email
-- was opened on, which is frequently not the one that is signed in. Requiring a
-- session to stop email is how an unsubscribe link becomes a lie, so this takes
-- the token and nothing else.
--
-- It only ever turns things *off*. A token that leaked could be used to stop
-- somebody's email — annoying, and undone with one command — and could never be
-- used to start it, read anything, or say anything.
create or replace function public.unsubscribe (p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  update public.notify_settings
     set daily = false
   where token = p_token
  returning true into v_found;

  return coalesce(v_found, false);
end;
$$;

-- Service role only. These read every address on the site between them, so
-- nothing that reaches a browser may call them.
revoke all on function public.pending_digests () from public, anon, authenticated;
revoke all on function public.mark_digested (uuid[]) from public, anon, authenticated;
revoke all on function public.unsubscribe (uuid) from public, anon, authenticated;

-- The unsubscribe page is a route, so nobody may open a room that shadows it.
-- `lib/shell/env.ts` keeps the same list and a test compares the two, so this
-- line and that map have to move together.
insert into public.reserved_slugs (slug, reason)
values ('unsubscribe', 'that is a route')
on conflict (slug) do nothing;
