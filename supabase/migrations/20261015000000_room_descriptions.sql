-- Longer room descriptions, and the maker can change theirs.
--
-- Two requests from the same person.
--
-- **100 characters, not 60.** Asked for after a 65-character description of
-- `pulsechain` was refused. Sixty was set for "the one line it gets at 380px",
-- but the description is not printed in the lobby at all — the lobby shows each
-- room's newest post — and everywhere it is printed (the bottom of a parent
-- room, the readable page, the share card) wraps or has room. The refusal also
-- names the length now; it was one sentence for both ends that named neither.
--
-- **`describe` lets whoever made a room change what it says it is for.** The
-- report: in the middle of `make`, answering "what is pulsechain for?", typing
-- `leave` or `go omaha` out of habit — and that becoming the room's
-- description, permanently, with no way to fix it. The client now asks before
-- accepting an answer that looks like a command; this is the repair for
-- whatever gets through anyway.
--
-- This is the first thing a room's maker can do that anybody else cannot, and
-- that is a change to "a room has no owner" (§4.2), so it is kept narrow:
--
--   * only the description — never the name, which is an address (§3.4), and
--     never whether it lists or where it grew out of;
--   * only rooms somebody made. The ten permanent rooms are the operator's,
--     and walls already say "what <name> is saying";
--   * the same rules as making one: verified, not banned, 3 to 100 characters.
--
-- Who made a room stays unreadable (§4.2 — nobody should be able to build a
-- list of whose rooms are whose). The check happens here, and a refusal says
-- "only whoever made it" without saying who that is.

-- create_room, with the new limit -----------------------------------------------
--
-- Same arguments, so `create or replace` and the grants stay. The body is
-- 20260806020000's unchanged apart from the length check.

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
  if char_length(v_gloss) < 3 or char_length(v_gloss) > 100 then
    raise exception 'a room’s description is 3 to 100 characters, and this is %.', char_length(v_gloss)
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


-- describe_room -----------------------------------------------------------------

create or replace function public.describe_room (p_slug citext, p_gloss text)
returns citext
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id     uuid := auth.uid ();
  v_slug   citext := lower(btrim(p_slug::text))::citext;
  v_gloss  text := btrim(p_gloss);
  v_room   public.rooms%rowtype;
  v_ok     boolean;
  v_banned boolean;
begin
  if v_id is null then
    raise exception 'you need a name before you can change a room'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_room from public.rooms where slug = v_slug;

  -- Hidden rooms answer the same as missing ones, so this cannot be used to
  -- find out what the operator has taken down.
  if not found or v_room.hidden_at is not null then
    raise exception 'no room called %', v_slug using errcode = 'no_data_found';
  end if;

  if v_room.owner_id is not null then
    raise exception 'a wall says what its person is saying, and that is not changed here.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_room.curated then
    raise exception '% is one of the rooms that came with the building, so it keeps its description.', v_slug
      using errcode = 'insufficient_privilege';
  end if;

  if v_room.created_by is distinct from v_id then
    raise exception 'only whoever made % can change what it says it is for.', v_slug
      using errcode = 'insufficient_privilege';
  end if;

  select p.verified_at is not null, p.banned_at is not null
    into v_ok, v_banned
    from public.profiles p where p.id = v_id;

  if coalesce(v_banned, false) then
    raise exception 'this account cannot post here.'
      using errcode = 'insufficient_privilege';
  end if;

  if not coalesce(v_ok, false) then
    raise exception 'check your email first — no link? type resend.'
      using errcode = 'insufficient_privilege';
  end if;

  if char_length(v_gloss) < 3 or char_length(v_gloss) > 100 then
    raise exception 'a room’s description is 3 to 100 characters, and this is %.', char_length(v_gloss)
      using errcode = 'check_violation';
  end if;

  update public.rooms set gloss = v_gloss where slug = v_slug;
  return v_slug;
end;
$$;

revoke all on function public.describe_room (citext, text) from public, anon;
grant execute on function public.describe_room (citext, text) to authenticated;
