-- Subtopics, without a tree.
--
-- Asked for as rooms inside rooms, three to five deep. That is the change most
-- likely to produce §4.2's named failure — "40 rooms with three people each
-- kills the entire feeling" — because a subtopic room is a slice of a slice and
-- starts emptier than a top-level one. It would also rewrite every address on
-- the site: `music/12` is room-then-post, and `music/jazz/bebop/4` is not, so
-- `Location`, both directions of the URL, `go`, `leave`, `older`, the share
-- cards and the lobby all change to carry the depth.
--
-- What people actually want from nesting is available for one column. Rooms are
-- already free to make; what is missing is *relatedness* — no way to see that
-- `jazz` came out of `music`. So a room records where it was made from, and its
-- parent lists them.
--
-- Nothing else moves. No address changes, no command changes, no URL changes.
-- If real nesting is wanted later, none of this is in the way.

alter table public.rooms
  add column if not exists from_room citext
    references public.rooms (slug) on delete set null;

comment on column public.rooms.from_room is
  'the room somebody was standing in when they made this one. a label for '
  'discovery, never a permission and never part of an address.';

-- The parent asks "what grew out of me", which is a lookup by this column.
create index if not exists rooms_from_room on public.rooms (from_room)
  where from_room is not null;

-- Public, unlike `created_by`. Who opened a room is deliberately not readable
-- (§4.2 — a room has no owner and nobody should be able to build a list of
-- whose rooms are whose); where it grew out of is the opposite, because the
-- whole point is that people see it.
grant select (
  slug, gloss, ephemeral, sort_order, next_post_no, created_at,
  owner_id, archived_at, hidden_at, curated, from_room
) on public.rooms to anon, authenticated;

-- create_room, with somewhere it came from ------------------------------------
--
-- Dropped and recreated rather than replaced: `create or replace function`
-- cannot change an argument list, and adding a defaulted parameter changes it.
-- The grants go with the drop, so they are reapplied below.
drop function if exists public.create_room (citext, text);

create or replace function public.create_room (
  p_slug  citext,
  p_gloss text,
  -- Where the person was standing. Optional, and never trusted blindly — see
  -- the checks before the insert.
  p_from  citext default null
)
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
  v_from    citext := nullif(lower(btrim(coalesce(p_from, '')::text)), '')::citext;
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

  /*
   * Where it grew out of, if anywhere.
   *
   * Checked rather than taken: the caller passes the room they were standing
   * in, and a client is not a source of truth about anything. A parent that is
   * not a real room, or is a wall, or is the room being made, is dropped and
   * the room is still made — this is a label, not a permission, and refusing to
   * create somebody's room over a bad label would be the tail wagging the dog.
   *
   * Walls are excluded because "jazz grew out of ~marisol" is not a thing
   * anybody means, and because a wall is not somewhere the lobby can send
   * people back to.
   */
  if v_from is not null
     and (v_from = v_slug
          or v_from ~ '^~'
          or not exists (select 1 from public.rooms where slug = v_from)) then
    v_from := null;
  end if;

  -- sort_order is not read for a user room: the lobby orders those by life,
  -- not by curation. Set past the curated block anyway so nothing collides if
  -- the operator ever promotes one.
  insert into public.rooms (slug, gloss, ephemeral, sort_order, created_by, from_room)
  values (v_slug, v_gloss, false, 500, v_id, v_from);

  return v_slug;
end;
$$;

revoke all on function public.create_room (citext, text, citext) from public, anon;
grant execute on function public.create_room (citext, text, citext) to authenticated;

-- What grew out of a room -------------------------------------------------------
--
-- Hidden rooms are excluded, because §6's lever has to reach every surface that
-- names a room. Quiet ones are not: the lobby drops a room after a fortnight of
-- silence and this listing is exactly the way back to one, which is the point
-- of it existing at all.
create or replace function public.rooms_from (p_slug citext)
returns table (slug citext, gloss text)
language sql
stable
security definer
set search_path = public
as $$
  select r.slug, r.gloss
    from public.rooms r
   where r.from_room = p_slug
     and r.hidden_at is null
   order by r.created_at;
$$;

grant execute on function public.rooms_from (citext) to anon, authenticated;
