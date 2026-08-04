-- The operator's day one.
--
-- §6 puts "any moderation tooling beyond a manual kill switch" out of scope,
-- which means the manual kill switch itself is in — and it did not exist. There
-- was no DELETE policy on any table, no ban, and no way to hide a post or a
-- room. The only lever was hand-written SQL, and the obvious hand-written SQL
-- was the wrong one: deleting an account cascades away every reply *other
-- people* wrote underneath it, and frees the offender's handle for immediate
-- re-registration, in a design where the handle is the identity (§4.6).
--
-- So everything here is a soft delete. Nothing is destroyed, the address is
-- never released (§3.4's allocator is monotonic, so hiding post 12 renumbers
-- nothing and 12 is never handed out again), and every lever has its inverse.
--
-- Also here, because they are the same day: a rate limit on contributing, which
-- did not exist at all, and §4.2's decay rule — "written but not enabled".

-- Columns ---------------------------------------------------------------------

alter table public.profiles
  add column banned_at     timestamptz,
  add column banned_reason text;

comment on column public.profiles.banned_at is
  'Set by ban(). The row stays: the name remains reserved and dead (§4.6), and their replies stay under other people''s posts.';

alter table public.posts   add column hidden_at timestamptz;
alter table public.replies add column hidden_at timestamptz;

comment on column public.posts.hidden_at is
  'Soft delete. The row and its replies survive, the address is never reused, and unhide_post() puts it back exactly as it was.';

alter table public.rooms
  add column hidden_at   timestamptz,
  add column archived_at timestamptz;

comment on column public.rooms.hidden_at is
  'The kill switch: the room and everything in it stop existing for readers.';

comment on column public.rooms.archived_at is
  '§4.2 decay — quiet, not gone. Dropped from the lobby listing, still reachable by name, and cleared the moment somebody posts.';

-- The rate limit and may_contribute both ask "what has this person written
-- lately", which was a scan of every post they had ever made.
drop index if exists posts_author;
create index posts_author_recent on public.posts (author_id, created_at desc);

-- Visibility ------------------------------------------------------------------
--
-- Both helpers are security definer on purpose. A policy expression runs with
-- the caller's rights, so a policy on `posts` that looked up `rooms` directly
-- would be filtered by the rooms policy — and once hidden rooms are unreadable,
-- that lookup returns no row and the check silently inverts. Reading the rule
-- has to bypass the rule.

create or replace function public.room_is_open (p_room citext)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select hidden_at is null from public.rooms where slug = p_room), false);
$$;

create or replace function public.post_is_readable (p_post_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.hidden_at is null
       and public.is_visible (p.room_slug, p.created_at)
       and public.room_is_open (p.room_slug)
      from public.posts p
     where p.id = p_post_id
  ), false);
$$;

grant execute on function public.room_is_open (citext) to anon, authenticated;
grant execute on function public.post_is_readable (bigint) to anon, authenticated;

-- A hidden room is gone. An archived one is merely quiet, so it stays readable
-- by name — §4.2's decay is "hidden from `look` and archived", not deleted.
drop policy "anyone may read rooms" on public.rooms;
create policy "anyone may read rooms"
  on public.rooms for select using (hidden_at is null);

drop policy "anyone may read posts that are still here" on public.posts;
create policy "anyone may read posts that are still here"
  on public.posts for select using (
    hidden_at is null
    and public.is_visible (room_slug, created_at)
    and public.room_is_open (room_slug)
  );

drop policy "anyone may read replies to posts that are still here" on public.replies;
create policy "anyone may read replies to posts that are still here"
  on public.replies for select using (
    hidden_at is null and public.post_is_readable (post_id)
  );

-- The read rule and the write rule are the same rule. Without this, a hidden
-- post is unreadable but still repliable by anyone who kept its internal id —
-- the client cannot find it, which is not the same as it being refused.
drop policy "you may reply as yourself" on public.replies;
create policy "you may reply as yourself"
  on public.replies for insert
  with check (author_id = auth.uid () and public.post_is_readable (post_id));

-- The lobby -------------------------------------------------------------------
-- Archived and hidden rooms leave the listing; a hidden post stops being a
-- room's proof of life. Stated here as well as in the policies because a
-- service-role reader bypasses RLS, and this view is what the lobby is.
create or replace view public.room_overview
with (security_invoker = true) as
select
  r.slug,
  r.gloss,
  r.ephemeral,
  r.sort_order,
  latest.body       as latest_body,
  latest.created_at as latest_at,
  author.name       as latest_author
from public.rooms r
left join lateral (
  select p.body, p.created_at, p.author_id
    from public.posts p
   where p.room_slug = r.slug
     and p.hidden_at is null
     and public.is_visible (p.room_slug, p.created_at)
   order by p.created_at desc
   limit 1
) latest on true
left join public.profiles author on author.id = latest.author_id
where r.hidden_at is null
  and r.archived_at is null;

-- Who may contribute ----------------------------------------------------------
--
-- Two changes beyond the ban.
--
-- VOLATILE, not STABLE. A stable function sees the snapshot taken at the start
-- of the *statement*, so `select create_post(...) from generate_series(1, 25)`
-- had every call observe "this account has written nothing" and the §4.7 gate
-- passed twenty-five times. Unreachable through PostgREST, where one RPC is one
-- statement, but it is the gate being enforced by the shape of the client
-- rather than by the database — which is the thing this file exists to stop
-- being true. A rate limit built on a stable read would have the same hole, and
-- there the loophole is the entire attack.
--
-- `exists` rather than `count(*)`: the question was only ever "any at all", and
-- the count read every row to answer it.
create or replace function public.may_contribute (p_user uuid)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  select coalesce((
    select case
             when p.banned_at   is not null then false
             when p.verified_at is not null then true
             else not exists (select 1 from public.posts   where author_id = p_user)
              and not exists (select 1 from public.replies where author_id = p_user)
           end
      from public.profiles p
     where p.id = p_user
  ), false);
$$;

grant execute on function public.may_contribute (uuid) to authenticated;

-- One gate for both write paths.
--
-- There was no rate limit on posting or replying at all. Twenty contributions
-- in five minutes is far above a fast conversation in a hallway (§3.10) and far
-- below anything a script would bother with, and it counts posts and replies
-- together because they are one verb (§3.3) and limiting them separately just
-- doubles the allowance.
--
-- Hidden rows still count. Hiding what somebody flooded should not hand them a
-- fresh allowance to do it again.
create or replace function public.require_can_contribute (p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_banned timestamptz;
  v_reason text;
  v_recent integer;
begin
  select banned_at, banned_reason into v_banned, v_reason
    from public.profiles where id = p_user;

  if v_banned is not null then
    -- §3.7 — say what is wrong. There is no fix to name here, so the reason is
    -- the most useful thing it can carry.
    raise exception 'you can''t say things here anymore%',
      case when coalesce(v_reason, '') = '' then '.' else ': ' || v_reason end
      using errcode = 'insufficient_privilege';
  end if;

  if not public.may_contribute (p_user) then
    raise exception 'check your email to keep saying things'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_recent
    from (
      select created_at from public.posts
       where author_id = p_user and created_at > now() - interval '5 minutes'
      union all
      select created_at from public.replies
       where author_id = p_user and created_at > now() - interval '5 minutes'
    ) recent;

  if v_recent >= 20 then
    raise exception 'too fast — that is a lot of words in a very short time'
      using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function public.require_can_contribute (uuid) from public, anon;

create or replace function public.create_post (p_room citext, p_body text)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_no integer;
  v_post    public.posts;
begin
  if auth.uid () is null then
    raise exception 'you have to be signed in to say something'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.require_can_contribute (auth.uid ());

  -- `hidden_at is null` is what makes the kill switch hold here: this function
  -- is security definer, so the read policy that hides the room does not apply,
  -- and anyone who remembered the name could keep posting into it.
  --
  -- Clearing archived_at in the same statement is §4.2's decay rule undoing
  -- itself: a room comes back to the lobby the moment somebody says something
  -- in it, at no extra cost.
  update public.rooms
     set next_post_no = next_post_no + 1,
         archived_at  = null
   where slug = p_room
     and hidden_at is null
  returning next_post_no - 1 into v_post_no;

  if v_post_no is null then
    raise exception 'no room called %', p_room using errcode = 'no_data_found';
  end if;

  insert into public.posts (room_slug, post_no, author_id, body)
  values (p_room, v_post_no, auth.uid (), p_body)
  returning * into v_post;

  return v_post;
end;
$$;

revoke all on function public.create_post (citext, text) from public;
grant execute on function public.create_post (citext, text) to authenticated;

create or replace function public.require_contribution_allowed ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_can_contribute (new.author_id);
  return new;
end;
$$;

-- The levers -------------------------------------------------------------------
--
-- service_role only. There is deliberately no admin flag on profiles and no
-- in-app moderation surface: §6 asks for a *manual* kill switch, and an admin
-- bit that authenticated users can be checked against is a privilege escalation
-- target that buys nothing when the operator is one person with psql
-- (scripts/moderate.sh).

create or replace function public.hide_post (p_room citext, p_post_no integer, p_hide boolean default true)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.posts
     set hidden_at = case when p_hide then now() else null end
   where room_slug = p_room
     and post_no = p_post_no
     and (hidden_at is null) = p_hide;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.hide_reply (p_reply_id bigint, p_hide boolean default true)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.replies
     set hidden_at = case when p_hide then now() else null end
   where id = p_reply_id
     and (hidden_at is null) = p_hide;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.hide_room (p_slug citext, p_hide boolean default true)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.rooms
     set hidden_at = case when p_hide then now() else null end
   where slug = p_slug
     and (hidden_at is null) = p_hide;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Ban, and the one composite operation the operator actually needs at 2am.
--
-- The account is not deleted, and that is the point: deleting it cascades away
-- every reply other people wrote under their posts, and releases the handle for
-- re-registration. Banned means the name stays reserved and dead (§4.6).
--
-- Hiding what they said is a separate argument rather than automatic, because
-- banning somebody for one thing should not silently erase a year of ordinary
-- conversation other people were part of.
create or replace function public.ban (
  p_name       citext,
  p_reason     text default null,
  p_hide_posts boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_hidden integer := 0;
begin
  select id into v_id from public.profiles where name = p_name;
  if v_id is null then
    raise exception 'no one called %', p_name using errcode = 'no_data_found';
  end if;

  update public.profiles
     set banned_at = now(), banned_reason = p_reason
   where id = v_id;

  if p_hide_posts then
    update public.posts set hidden_at = now()
     where author_id = v_id and hidden_at is null;
    get diagnostics v_hidden = row_count;

    update public.replies set hidden_at = now()
     where author_id = v_id and hidden_at is null;
  end if;

  return v_hidden;
end;
$$;

-- Undo, including the hiding — an operator who cannot reverse a mistake has a
-- lever they will hesitate to pull, which is the same as not having one.
create or replace function public.unban (p_name citext, p_restore_posts boolean default true)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  v_restored integer := 0;
begin
  select id into v_id from public.profiles where name = p_name;
  if v_id is null then
    raise exception 'no one called %', p_name using errcode = 'no_data_found';
  end if;

  update public.profiles
     set banned_at = null, banned_reason = null
   where id = v_id;

  if p_restore_posts then
    update public.posts set hidden_at = null
     where author_id = v_id and hidden_at is not null;
    get diagnostics v_restored = row_count;

    update public.replies set hidden_at = null
     where author_id = v_id and hidden_at is not null;
  end if;

  return v_restored;
end;
$$;

-- §4.2 — "decay rules written but not enabled."
--
-- Written, and deliberately called by nothing: no cron, no trigger, no schedule.
-- Enabling it is one line in a scheduler on the day the room list stops looking
-- alive on its own, which is the condition §4.2 sets for revisiting this.
--
-- Ephemeral rooms are skipped: commons is empty by design every morning (§3.10)
-- and archiving the front door is not decay, it is a bug.
create or replace function public.archive_quiet_rooms (p_idle interval default interval '7 days')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.rooms r
     set archived_at = now()
   where r.archived_at is null
     and r.hidden_at is null
     and not r.ephemeral
     and not exists (
       select 1 from public.posts p
        where p.room_slug = r.slug
          and p.hidden_at is null
          and p.created_at > now() - p_idle
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.hide_post (citext, integer, boolean)',
    'public.hide_reply (bigint, boolean)',
    'public.hide_room (citext, boolean)',
    'public.ban (citext, text, boolean)',
    'public.unban (citext, boolean)',
    'public.archive_quiet_rooms (interval)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    -- service_role exists on every Supabase project; the test shim creates it.
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end
$$;
