-- User-created rooms, against §4.2.
--
-- §4.2 is unambiguous: "a fixed, curated set at launch. room creation stays
-- closed", because "40 rooms with three people each kills the entire feeling".
-- That is decided differently here, by the person whose site it is, and the
-- doc's warning is still right about the thing it is actually about.
--
-- Read the warning carefully and it is not about how many rooms exist. It is
-- about the room *list* — the first impression, the thing that has to read as a
-- building rather than a directory. A room nobody is in does no harm sitting in
-- the database; it does harm sitting in the lobby. So creation opens and the
-- lobby stays curated:
--
--   * anybody verified may make a room, three a week;
--   * the six curated rooms always show, in their curated order;
--   * a user room shows only while it has life in it, and fades out quietly
--     when it does not — reachable forever by name and by search, just not
--     taking up the shop window.
--
-- The fade is §4.2's own decay rule, which has been "written but not enabled"
-- since it was first added. It is enabled here, and by a clause in the lobby
-- query rather than by a scheduled job: nobody is running cron for this, and a
-- decay rule that needs a cron nobody set up is a decay rule that never runs.
-- `archive_quiet_rooms` stays exactly what it was, a manual lever.

-- Who made it ----------------------------------------------------------------
--
-- Separate from owner_id, which means "this is that person's wall" and carries
-- a unique index and a `~` slug with it. This is only a record of who opened
-- the door.
--
-- `on delete set null` and not cascade, deliberately. A room outlives the
-- person who made it, because by then the conversations in it belong to
-- everybody who turned up. Cascading would delete other people's posts to
-- satisfy one person leaving, which is the same mistake `forget` exists to
-- avoid.
alter table public.rooms
  add column created_by uuid references public.profiles (id) on delete set null;

comment on column public.rooms.created_by is
  'who opened it. null means curated — seeded, or opened by the operator.';

create index rooms_created_by on public.rooms (created_by) where created_by is not null;

-- Whether it is furniture, as its own fact.
--
-- The lobby first read this as `created_by is null`, which is the same thing
-- until it is not: `created_by` is `on delete set null`, so erasing the person
-- who opened a room would silently promote their room to a curated one — a
-- permanent fixture in the lobby that no longer fades and that nobody chose.
-- The two questions are different and deserve two columns.
alter table public.rooms
  add column curated boolean not null default false;

comment on column public.rooms.curated is
  'true for the seeded rooms and anything the operator opens: always in the lobby, never faded.';

-- Everything that exists at this point predates user-created rooms, so all of
-- it is curated by definition.
update public.rooms set curated = true where owner_id is null;

-- Names nobody may take ------------------------------------------------------
--
-- Every one of these is a real path under app/. A room called `terms` would be
-- shadowed by /terms forever: `go terms` would work, thewall.social/terms would
-- not, and §3.4's "the prompt path is the URL" would be quietly false for one
-- room. It is a table rather than a constant so adding a route means adding a
-- row, and so the message can name the reason.
create table public.reserved_slugs (
  slug   citext primary key,
  reason text not null
);

alter table public.reserved_slugs enable row level security;
create policy "anyone may read reserved slugs"
  on public.reserved_slugs for select using (true);
grant select on public.reserved_slugs to anon, authenticated;

insert into public.reserved_slugs (slug, reason) values
  ('lobby',           'the lobby lives there'),
  ('api',             'that is a route'),
  ('auth',            'that is a route'),
  ('legal',           'that is a route'),
  ('terms',           'that is a route'),
  ('privacy',         'that is a route'),
  ('icon',            'that is a route'),
  ('apple-icon',      'that is a route'),
  ('opengraph-image', 'that is a route')
on conflict (slug) do nothing;

-- Making one -----------------------------------------------------------------
--
-- security definer, because `authenticated` has select on rooms and nothing
-- else and that stays true: this function is the only door, so every rule below
-- is unroutable-around rather than a policy somebody has to get right twice.
--
-- VOLATILE. A stable function sees the snapshot from the start of the
-- statement, and `select create_room(...) from generate_series(1, 25)` would
-- have every call observe "you have made no rooms this week" — which is exactly
-- how the §4.7 one-contribution gate was defeated before anybody noticed.
create or replace function public.create_room (p_slug citext, p_gloss text)
returns citext
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id      uuid := auth.uid ();
  v_ok      boolean;
  v_banned  boolean;
  v_reason  text;
  v_made    integer;
  v_oldest  timestamptz;
  v_wait    integer;
  v_gloss   text := btrim(p_gloss);
  v_slug    citext := lower(btrim(p_slug::text))::citext;
begin
  if v_id is null then
    raise exception 'you need a name before you can make a room'
      using errcode = 'insufficient_privilege';
  end if;

  -- Verified, not merely named. §4.7 lets an unverified account have one
  -- contribution so the held sentence lands; a room is not that. It is a
  -- permanent address in a shared space, and the cost of making one has to be
  -- an inbox somebody actually reads.
  select p.verified_at is not null, p.banned_at is not null
    into v_ok, v_banned
    from public.profiles p where p.id = v_id;

  -- Banned first, and said plainly. Folding it into the verified check told a
  -- banned account to go and check its email, which is a message that sends
  -- somebody looking for a link that will not help them.
  if coalesce(v_banned, false) then
    raise exception 'this account cannot post here.'
      using errcode = 'insufficient_privilege';
  end if;

  if not coalesce(v_ok, false) then
    raise exception 'check your email first — a room is permanent, so it wants a verified account. no link? type resend.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Three a week. §4.2's failure is a lobby that fills faster than it empties,
  -- and the cap is what keeps one enthusiastic evening from being fifteen
  -- rooms — while leaving room for somebody who actually has three ideas.
  --
  -- A rolling window, not a calendar week. A week that resets at midnight on
  -- Sunday hands everybody three fresh rooms at the same moment, which is the
  -- one time you would least like it to.
  select count(*), min(created_at)
    into v_made, v_oldest
    from public.rooms
   where created_by = v_id
     and created_at > now() - interval '7 days';

  if v_made >= 3 then
    -- Whole days, rounded up. `justify_interval` renders
    -- "6 days 23:59:59.873763", which is a debug dump rather than an answer to
    -- "when can I make another one".
    v_wait := ceil(extract(epoch from (v_oldest + interval '7 days' - now())) / 86400);
    raise exception 'that is three rooms this week, which is the limit. you can make another %, and rooms are easier to make than to fill.',
      case when v_wait <= 1 then 'tomorrow' else 'in ' || v_wait || ' days' end
      using errcode = 'too_many_rows';
  end if;

  if v_slug ~ '^~' then
    raise exception '~ names a wall, and you already have one. pick a plain name.'
      using errcode = 'check_violation';
  end if;

  if v_slug !~ '^[a-z0-9-]{2,24}$' then
    raise exception 'a room name is 2 to 24 characters of a-z, 0-9 and -. nothing else, and no spaces.'
      using errcode = 'check_violation';
  end if;

  select reason into v_reason from public.reserved_slugs where slug = v_slug;
  if v_reason is not null then
    raise exception '% is spoken for — %.', v_slug, v_reason
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.rooms where slug = v_slug) then
    raise exception '% already exists. try: go %', v_slug, v_slug
      using errcode = 'unique_violation';
  end if;

  -- Somebody's name is not available as a room.
  --
  -- `go marisol` and `go ~marisol` are already different addresses, so nothing
  -- breaks — but a room called `marisol` sits in the lobby under her name, with
  -- a gloss its maker chose, and §4.6's whole argument about impersonation is
  -- that it is aimed at the reader. The reader is who this protects.
  if exists (select 1 from public.profiles where name = v_slug) then
    raise exception '% is somebody''s name. try: go ~% to see them.', v_slug, v_slug
      using errcode = 'unique_violation';
  end if;

  -- §3.6 and §3.11 both rest on the gloss: the lobby reads as a building
  -- because every door says what is behind it. A room without one is a slug in
  -- a list, so it is required rather than optional, and short enough to fit the
  -- one line it gets at 380px.
  if char_length(v_gloss) < 3 or char_length(v_gloss) > 60 then
    raise exception 'say what it is for, in a few words — that is the line under the name in the lobby.'
      using errcode = 'check_violation';
  end if;

  -- sort_order is not read for a user room: the lobby orders those by life,
  -- not by curation. Set past the curated block anyway so nothing collides if
  -- the operator ever promotes one.
  insert into public.rooms (slug, gloss, ephemeral, sort_order, created_by)
  values (v_slug, v_gloss, false, 500, v_id);

  return v_slug;
end;
$$;

revoke all on function public.create_room (citext, text) from public, anon;
grant execute on function public.create_room (citext, text) to authenticated;

-- The lobby ------------------------------------------------------------------
--
-- Two changes: it says whether a room is curated, and a user room drops out of
-- it once nothing has been said there for a fortnight.
--
-- The fade is measured from the newest post, or from when the room was made if
-- there is nothing in it yet — so a room made this morning is in the lobby this
-- morning, which is the whole of its chance to find anybody. §5's "an empty
-- room is worse than no room" is why that grace is two weeks and not forever.
--
-- Nothing here hides anything. A faded room answers to its name, keeps its
-- posts and its addresses, appears in search, and comes straight back the
-- moment somebody says something in it.
create or replace view public.room_overview
with (security_invoker = true) as
select
  r.slug,
  r.gloss,
  r.ephemeral,
  r.sort_order,
  latest.body       as latest_body,
  latest.created_at as latest_at,
  author.name       as latest_author,
  -- Appended rather than slotted in beside sort_order, where it reads better:
  -- `create or replace view` may only add columns at the end, and reordering
  -- would mean dropping the view — which on a security_invoker view means
  -- dropping the thing every anonymous lobby read depends on, mid-migration.
  r.curated
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
  and r.archived_at is null
  and r.owner_id is null
  and (
    r.curated
    or coalesce(latest.created_at, r.created_at) > now() - interval '14 days'
  );

-- Finding a room -------------------------------------------------------------
--
-- Once rooms multiply, "which rooms are there" stops being answered by looking
-- at the lobby, and a room nobody can find is a room that dies. Name and gloss
-- both, because half the time you remember what a room was *for* and not what
-- it was called.
--
-- Faded and archived rooms are included on purpose: this is the way back to
-- one. Hidden rooms are not — `close` means gone.
create or replace function public.find_rooms (p_term text, p_limit integer default 20)
returns table (
  slug        citext,
  gloss       text,
  curated     boolean,
  in_lobby    boolean,
  latest_at   timestamptz,
  post_count  bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.slug,
    r.gloss,
    r.curated,
    r.archived_at is null and (
      r.curated
      or coalesce(newest.at, r.created_at) > now() - interval '14 days'
    ),
    newest.at,
    coalesce(counted.n, 0)
  from public.rooms r
  left join lateral (
    select max(p.created_at) as at
      from public.posts p
     where p.room_slug = r.slug and p.hidden_at is null
  ) newest on true
  left join lateral (
    select count(*) as n
      from public.posts p
     where p.room_slug = r.slug and p.hidden_at is null
  ) counted on true
  where r.hidden_at is null
    and r.owner_id is null
    and (
      p_term is null
      or btrim(p_term) = ''
      -- `like` with the term escaped, not ilike with it interpolated: a search
      -- for "100%" must not become a wildcard that matches every room.
      or r.slug::text ilike '%' || replace(replace(replace(btrim(p_term), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
      or r.gloss ilike '%' || replace(replace(replace(btrim(p_term), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
    )
  order by r.curated desc, newest.at desc nulls last, r.slug
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.find_rooms (text, integer) to anon, authenticated;

-- Searching what was said ----------------------------------------------------
--
-- `find` has always read the posts table directly from the client and has
-- always therefore missed every reply — which on a site whose §4.3 shape is
-- "post, then a flat list of answers" is most of what anybody says. This is one
-- query over both, so a reply is findable and carries the address of the post
-- it is under.
--
-- Walls are searchable, and commons is not: an ephemeral room has no permanent
-- address, so a hit there would be somewhere you cannot go (§3.10).
create or replace function public.search_said (
  p_text  text default null,
  p_room  citext default null,
  p_by    citext default null,
  p_since timestamptz default null,
  p_limit integer default 20
)
returns table (
  room       citext,
  post_no    integer,
  author     citext,
  body       text,
  created_at timestamptz,
  is_reply   boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with term as (
    select case
             when p_text is null or btrim(p_text) = '' then null
             else '%' || replace(replace(replace(btrim(p_text), '\', '\\'), '%', '\%'), '_', '\_') || '%'
           end as pattern
  ),
  said as (
    select p.room_slug as room, p.post_no, a.name as author, p.body, p.created_at,
           false as is_reply
      from public.posts p
      join public.rooms rm on rm.slug = p.room_slug
      join public.profiles a on a.id = p.author_id
     where p.hidden_at is null
       and rm.hidden_at is null
       and not rm.ephemeral

    union all

    select p.room_slug as room, p.post_no, a.name as author, r.body, r.created_at,
           true as is_reply
      from public.replies r
      join public.posts p on p.id = r.post_id
      join public.rooms rm on rm.slug = p.room_slug
      join public.profiles a on a.id = r.author_id
     where r.hidden_at is null
       -- A reply under a hidden post is hidden with it: the address it would
       -- send you to shows nothing, so a hit there is a dead end.
       and p.hidden_at is null
       and rm.hidden_at is null
       and not rm.ephemeral
  )
  select said.room, said.post_no, said.author, said.body, said.created_at, said.is_reply
    from said, term
   where (term.pattern is null or said.body ilike term.pattern escape '\')
     and (p_room  is null or said.room = p_room)
     and (p_by    is null or said.author = p_by)
     and (p_since is null or said.created_at >= p_since)
   order by said.created_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.search_said (text, citext, citext, timestamptz, integer) to anon, authenticated;

-- Indexes for the two searches above. Both were sequential scans over every
-- post on the site, which is fine at six rooms and is the first thing to hurt
-- once rooms are something people make.
create index if not exists posts_created_at on public.posts (created_at desc);
create index if not exists replies_created_at on public.replies (created_at desc);
