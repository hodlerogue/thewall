-- Reporting, hiding what enough people report, and somewhere to review it.
--
-- Asked for as: "there should be a report feature, for example for an
-- inappropriately named room or post someone makes. and if enough people
-- report it, it should be auto hidden. need some kind of admin dashboard where
-- i can review this stuff and restore anything if necessary."
--
-- This reverses a decision, and the old reasoning still matters. The moderation
-- migration (20260804020000) says there is "deliberately no admin flag on
-- profiles and no in-app moderation surface", because an admin bit a signed-in
-- user can be checked against is an escalation target — steal that session and
-- you hold the site — and buys nothing when the operator is one person with
-- psql. Reports change the second half: once other people are flagging things,
-- somebody has to look at them, and psql is not where that should happen. The
-- first half is still true, so the admin role is built to be worth as little as
-- possible to whoever might steal it:
--
--   * Admin is a row in `public.admins`, which nothing a browser can call will
--     ever write. It is granted with SQL by whoever holds the database.
--   * An admin can hide, restore, dismiss reports and set the threshold. Not
--     ban, not erase, not read anybody's email address. Those stay in
--     scripts/moderate.sh, behind the database password.
--   * Everything an admin does is written to `public.moderation_log`.
--   * Nothing is deleted. Hidden means hidden_at is set, exactly as the
--     existing levers have always done it (§3.4: an address is never reused).
--
-- Who can report: a verified, unbanned account. Reporting is the cheapest
-- lever on the site — enough of them hide something — so it costs an inbox,
-- like making a room does, and twenty a day each.
--
-- What can be reported: a room somebody made, a post, a reply — including on
-- walls. Not the ten rooms that came with the building (the operator's), not a
-- wall as a whole (that is reporting a person, which is a different feature),
-- and not commons, where nothing has an address and everything is gone in a day.

-- Who may use the dashboard ------------------------------------------------------

create table if not exists public.admins (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  added_at   timestamptz not null default now()
);

comment on table public.admins is
  'Who may use /admin. Written only with SQL — no function a browser can call '
  'touches it. To add one: insert into public.admins (profile_id) select id '
  'from public.profiles where name = ''<name>'';';

alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

-- The one setting ------------------------------------------------------------------

create table if not exists public.report_settings (
  id        boolean primary key default true check (id),
  threshold integer not null default 3 check (threshold between 1 and 100)
);
insert into public.report_settings (id) values (true) on conflict (id) do nothing;

comment on table public.report_settings is
  'One row. threshold: how many different people reporting the same thing hides '
  'it until an admin looks. Three, so one angry person cannot hide anything and '
  'two need a third to agree.';

alter table public.report_settings enable row level security;
revoke all on public.report_settings from anon, authenticated;

-- Reports ---------------------------------------------------------------------------

create table if not exists public.reports (
  id          bigserial primary key,
  -- The address, the way the site writes it: `room`, `room/12`, `room/12#3`.
  -- Text rather than three nullable columns so "one report per person per
  -- thing" is one unique index that cannot be dodged with a null.
  target      text not null,
  room_slug   citext not null,
  post_no     integer,
  reply_no    integer,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason      text check (reason is null or char_length(reason) <= 200),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolution  text check (resolution in ('restored', 'hidden', 'dismissed')),
  unique (target, reporter_id)
);

create index if not exists reports_open on public.reports (target) where resolved_at is null;

comment on table public.reports is
  'One row per person per reported thing. Open while resolved_at is null; only '
  'open reports count toward the threshold. A resolved report keeps its row, so '
  'the same people cannot report the same thing again after it is restored.';

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

-- What admins did ---------------------------------------------------------------------

create table if not exists public.moderation_log (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  admin_id uuid references public.profiles (id) on delete set null,
  action   text not null,
  target   text not null
);

alter table public.moderation_log enable row level security;
revoke all on public.moderation_log from anon, authenticated;

-- /admin is a page, so it cannot be a room ------------------------------------------

insert into public.reserved_slugs (slug, reason)
values ('admin', 'that is a route')
on conflict (slug) do nothing;

-- Shared: find the thing an address names -------------------------------------------
--
-- Not callable from a browser. Returns the kind and whatever identifies the row
-- to the hide functions, or nothing when the address names nothing.
create or replace function public.report_target (
  p_room     citext,
  p_post_no  integer,
  p_reply_no integer,
  out kind      text,
  out post_id   bigint,
  out reply_id  bigint,
  out author_id uuid,
  out hidden    boolean,
  out curated   boolean,
  out ephemeral boolean,
  out wall      boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
begin
  select * into v_room from public.rooms where slug = lower(btrim(p_room::text))::citext;
  if not found then return; end if;

  curated   := v_room.curated;
  ephemeral := v_room.ephemeral;
  wall      := v_room.owner_id is not null;

  if p_post_no is null then
    kind := 'room';
    author_id := v_room.created_by;
    hidden := v_room.hidden_at is not null;
    return;
  end if;

  select p.id, p.author_id, (p.hidden_at is not null or v_room.hidden_at is not null)
    into post_id, author_id, hidden
    from public.posts p
   where p.room_slug = v_room.slug and p.post_no = p_post_no;
  if post_id is null then return; end if;

  if p_reply_no is null then
    kind := 'post';
    return;
  end if;

  select x.id, x.author_id, (x.hidden_at is not null or hidden)
    into reply_id, author_id, hidden
    from public.replies x
   where x.post_id = report_target.post_id and x.reply_no = p_reply_no;
  if reply_id is null then post_id := null; return; end if;

  kind := 'reply';
end;
$$;

revoke all on function public.report_target (citext, integer, integer) from public, anon, authenticated;

create or replace function public.report_address (p_room citext, p_post_no integer, p_reply_no integer)
returns text
language sql
immutable
as $$
  select lower(btrim(p_room::text))
         || coalesce('/' || p_post_no, '')
         || coalesce('#' || p_reply_no, '');
$$;

revoke all on function public.report_address (citext, integer, integer) from public, anon, authenticated;

-- Hide or show whatever an address names, through the existing levers.
create or replace function public.set_hidden (p_room citext, p_post_no integer, p_reply_no integer, p_hide boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
begin
  select * into t from public.report_target (p_room, p_post_no, p_reply_no);
  if t.kind = 'room'  then perform public.hide_room (lower(btrim(p_room::text))::citext, p_hide); end if;
  if t.kind = 'post'  then perform public.hide_post (lower(btrim(p_room::text))::citext, p_post_no, p_hide); end if;
  if t.kind = 'reply' then perform public.hide_reply (t.reply_id, p_hide); end if;
end;
$$;

revoke all on function public.set_hidden (citext, integer, integer, boolean) from public, anon, authenticated;

-- report ---------------------------------------------------------------------------------
--
-- Returns what happened, as a word the client turns into a sentence:
--   reported  — counted
--   already   — this person had already reported it
--   hidden    — counted, and that was enough: it is hidden until an admin looks
create or replace function public.report_content (
  p_room     citext,
  p_post_no  integer default null,
  p_reply_no integer default null,
  p_reason   text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id        uuid := auth.uid ();
  v_ok        boolean;
  v_banned    boolean;
  v_reason    text := nullif(btrim(coalesce(p_reason, '')), '');
  v_target    text := public.report_address (p_room, p_post_no, p_reply_no);
  v_threshold integer;
  v_open      integer;
  v_inserted  integer;
  t           record;
begin
  if v_id is null then
    raise exception 'you need a name before you can report something'
      using errcode = 'insufficient_privilege';
  end if;

  select p.verified_at is not null, p.banned_at is not null
    into v_ok, v_banned
    from public.profiles p where p.id = v_id;

  if coalesce(v_banned, false) then
    raise exception 'this account cannot post here.' using errcode = 'insufficient_privilege';
  end if;
  if not coalesce(v_ok, false) then
    raise exception 'check your email first — reporting needs a verified account. no link? type resend.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into t from public.report_target (p_room, p_post_no, p_reply_no);

  if t.kind is null then
    raise exception 'there is nothing at %', v_target using errcode = 'no_data_found';
  end if;
  if t.hidden then
    return 'hidden';
  end if;
  if t.kind = 'room' and t.curated then
    raise exception '% came with the building — if something in it is wrong, report the post.', v_target
      using errcode = 'check_violation';
  end if;
  if t.kind = 'room' and t.wall then
    raise exception 'that is somebody''s wall. report a post on it rather than the wall itself.'
      using errcode = 'check_violation';
  end if;
  if t.ephemeral then
    raise exception 'commons keeps nothing — whatever it is will be gone within a day.'
      using errcode = 'check_violation';
  end if;
  if t.author_id = v_id then
    raise exception 'that one is yours. if it should not be there, it is yours to stop saying.'
      using errcode = 'check_violation';
  end if;
  if v_reason is not null and char_length(v_reason) > 200 then
    raise exception 'a reason is 200 characters at most, and this is %.', char_length(v_reason)
      using errcode = 'check_violation';
  end if;

  if (select count(*) from public.reports
       where reporter_id = v_id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'that is twenty reports today, which is the limit. thank you — they are being read.'
      using errcode = 'too_many_rows';
  end if;

  insert into public.reports (target, room_slug, post_no, reply_no, reporter_id, reason)
  values (v_target, lower(btrim(p_room::text))::citext, p_post_no, p_reply_no, v_id, v_reason)
  on conflict (target, reporter_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return 'already';
  end if;

  select threshold into v_threshold from public.report_settings;
  select count(*) into v_open from public.reports where target = v_target and resolved_at is null;

  if v_open >= v_threshold then
    perform public.set_hidden (p_room, p_post_no, p_reply_no, true);
    insert into public.moderation_log (admin_id, action, target)
    values (null, 'hidden by ' || v_open || ' reports', v_target);
    return 'hidden';
  end if;

  return 'reported';
end;
$$;

revoke all on function public.report_content (citext, integer, integer, text) from public, anon;
grant execute on function public.report_content (citext, integer, integer, text) to authenticated;

-- The dashboard ---------------------------------------------------------------------------

create or replace function public.is_admin ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where profile_id = auth.uid ());
$$;

revoke all on function public.is_admin () from public, anon;
grant execute on function public.is_admin () to authenticated;

create or replace function public.require_admin ()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin () then
    raise exception 'that is for admins.' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke all on function public.require_admin () from public, anon, authenticated;

-- Everything that needs a decision: anything with open reports, and anything
-- hidden right now (by reports, by an admin, or by scripts/moderate.sh), so
-- that "restore anything" covers everything that is hidden.
create or replace function public.admin_review ()
returns table (
  target      text,
  kind        text,
  room_slug   citext,
  post_no     integer,
  reply_no    integer,
  content     text,
  author      text,
  reports     integer,
  reasons     text[],
  reporters   text[],
  last_report timestamptz,
  hidden_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin ();

  return query
  with items as (
    -- Reported, open.
    select distinct r.room_slug, r.post_no, r.reply_no from public.reports r where r.resolved_at is null
    union
    select x.slug, null::integer, null::integer from public.rooms x where x.hidden_at is not null and x.owner_id is null
    union
    select p.room_slug, p.post_no, null::integer from public.posts p where p.hidden_at is not null
    union
    select p.room_slug, p.post_no, x.reply_no
      from public.replies x join public.posts p on p.id = x.post_id
     where x.hidden_at is not null
  )
  select
    public.report_address (i.room_slug, i.post_no, i.reply_no),
    case when i.post_no is null then 'room' when i.reply_no is null then 'post' else 'reply' end,
    i.room_slug, i.post_no, i.reply_no,
    case
      when i.post_no is null then (select rm.gloss from public.rooms rm where rm.slug = i.room_slug)
      when i.reply_no is null then (select p.body from public.posts p where p.room_slug = i.room_slug and p.post_no = i.post_no)
      else (select x.body from public.replies x join public.posts p on p.id = x.post_id
             where p.room_slug = i.room_slug and p.post_no = i.post_no and x.reply_no = i.reply_no)
    end,
    (select pr.name::text from public.profiles pr where pr.id = (
      case
        when i.post_no is null then (select rm.created_by from public.rooms rm where rm.slug = i.room_slug)
        when i.reply_no is null then (select p.author_id from public.posts p where p.room_slug = i.room_slug and p.post_no = i.post_no)
        else (select x.author_id from public.replies x join public.posts p on p.id = x.post_id
               where p.room_slug = i.room_slug and p.post_no = i.post_no and x.reply_no = i.reply_no)
      end)),
    (select count(*)::integer from public.reports r
      where r.target = public.report_address (i.room_slug, i.post_no, i.reply_no) and r.resolved_at is null),
    (select coalesce(array_agg(r.reason order by r.created_at) filter (where r.reason is not null), '{}')
       from public.reports r
      where r.target = public.report_address (i.room_slug, i.post_no, i.reply_no) and r.resolved_at is null),
    (select coalesce(array_agg(pr.name::text order by r.created_at), '{}')
       from public.reports r join public.profiles pr on pr.id = r.reporter_id
      where r.target = public.report_address (i.room_slug, i.post_no, i.reply_no) and r.resolved_at is null),
    (select max(r.created_at) from public.reports r
      where r.target = public.report_address (i.room_slug, i.post_no, i.reply_no) and r.resolved_at is null),
    case
      when i.post_no is null then (select rm.hidden_at from public.rooms rm where rm.slug = i.room_slug)
      when i.reply_no is null then (select p.hidden_at from public.posts p where p.room_slug = i.room_slug and p.post_no = i.post_no)
      else (select x.hidden_at from public.replies x join public.posts p on p.id = x.post_id
             where p.room_slug = i.room_slug and p.post_no = i.post_no and x.reply_no = i.reply_no)
    end
  from items i
  order by 11 desc nulls last, 12 desc nulls last
  limit 500;
end;
$$;

revoke all on function public.admin_review () from public, anon;
grant execute on function public.admin_review () to authenticated;

-- restore: make it visible. hide: make it hidden. dismiss: leave it as it is.
-- All three close the open reports on it and are logged.
create or replace function public.admin_resolve (
  p_room     citext,
  p_post_no  integer,
  p_reply_no integer,
  p_action   text
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_target text := public.report_address (p_room, p_post_no, p_reply_no);
  t        record;
begin
  perform public.require_admin ();

  if p_action not in ('restore', 'hide', 'dismiss') then
    raise exception 'restore, hide or dismiss' using errcode = 'check_violation';
  end if;

  select * into t from public.report_target (p_room, p_post_no, p_reply_no);
  if t.kind is null then
    raise exception 'there is nothing at %', v_target using errcode = 'no_data_found';
  end if;

  if p_action = 'restore' then perform public.set_hidden (p_room, p_post_no, p_reply_no, false); end if;
  if p_action = 'hide'    then perform public.set_hidden (p_room, p_post_no, p_reply_no, true);  end if;

  update public.reports
     set resolved_at = now(),
         resolved_by = auth.uid (),
         resolution  = case p_action when 'restore' then 'restored' when 'hide' then 'hidden' else 'dismissed' end
   where target = v_target and resolved_at is null;

  insert into public.moderation_log (admin_id, action, target) values (auth.uid (), p_action, v_target);
  return v_target;
end;
$$;

revoke all on function public.admin_resolve (citext, integer, integer, text) from public, anon;
grant execute on function public.admin_resolve (citext, integer, integer, text) to authenticated;

create or replace function public.admin_threshold (p_set integer default null)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v integer;
begin
  perform public.require_admin ();
  if p_set is not null then
    if p_set < 1 or p_set > 100 then
      raise exception 'between 1 and 100' using errcode = 'check_violation';
    end if;
    update public.report_settings set threshold = p_set;
    insert into public.moderation_log (admin_id, action, target)
    values (auth.uid (), 'threshold ' || p_set, '-');
  end if;
  select threshold into v from public.report_settings;
  return v;
end;
$$;

revoke all on function public.admin_threshold (integer) from public, anon;
grant execute on function public.admin_threshold (integer) to authenticated;
