-- Walls — §3.10, reversed on purpose.
--
-- The doc's most emphatic architectural warning is that a space which absorbs
-- activity "deletes the geography that makes this feel like a place", and
-- profiles were built as a view for exactly that reason. This adds the place
-- back, deliberately, because the site is called thewall and somewhere to put
-- your own things is what people asked for.
--
-- The shape is chosen so the warning still has teeth: **a wall is a room**. It
-- is not a new kind of object with its own posting rules, its own addresses and
-- its own moderation story — it is a row in `rooms` with an owner, so the
-- allocator, the reply trigger, the expiry policy, mail, search and every lever
-- in scripts/moderate.sh apply to it already and cannot drift away from it.
--
-- The one thing walls do not get is a place in the lobby. §4.2 is blunt that
-- forty rooms with three people each kills the feeling, and a room per person
-- is precisely that — so `room_overview` keeps showing the six curated rooms
-- and nothing else. A wall is reached through its owner, never by browsing.

alter table public.rooms
  add column owner_id uuid references public.profiles (id) on delete cascade;

comment on column public.rooms.owner_id is
  'Whose wall this is. Null for the curated rooms, which belong to nobody.';

-- One wall each. Not a policy, a fact about what a wall is.
create unique index rooms_owner on public.rooms (owner_id) where owner_id is not null;

-- `~marisol`. The tilde is already how the product says "a person" in a path
-- and in the prompt (§3.4), so a wall's address needs no new vocabulary.
alter table public.rooms drop constraint rooms_slug_shape;
alter table public.rooms add constraint rooms_slug_shape check (
  slug ~ '^[a-z0-9-]{2,24}$' or slug ~ '^~[a-z0-9_]{2,20}$'
);

-- The two halves cannot come apart: a room with an owner is a wall and looks
-- like one, and a room without an owner is a room and does not.
alter table public.rooms add constraint rooms_wall_shape check (
  (owner_id is null and slug !~ '^~') or (owner_id is not null and slug ~ '^~')
);

-- A rename has to take the wall with it, or `/~newname` is empty and the posts
-- are stranded at an address nobody can reach. The address is a name, and names
-- move (§4.6) — so the foreign key has to allow the slug to move too.
alter table public.posts drop constraint posts_room_slug_fkey;
alter table public.posts add constraint posts_room_slug_fkey
  foreign key (room_slug) references public.rooms (slug) on update cascade on delete cascade;

create or replace function public.change_name (p_name citext)
returns citext
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id      uuid := auth.uid ();
  v_current citext;
  v_since   timestamptz;
  v_banned  timestamptz;
  v_recent  integer;
begin
  if v_id is null then
    raise exception 'you have to be signed in to change your name'
      using errcode = 'insufficient_privilege';
  end if;

  select name, name_since, banned_at into v_current, v_since, v_banned
    from public.profiles where id = v_id;

  if v_current is null then
    raise exception 'you do not have a name yet' using errcode = 'no_data_found';
  end if;

  if v_banned is not null then
    raise exception 'you can''t say things here anymore.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_current = p_name then
    raise exception 'that is already your name' using errcode = 'check_violation';
  end if;

  select count(*) into v_recent
    from public.name_history
   where profile_id = v_id
     and released_at > now() - interval '1 hour';

  if v_recent >= 5 then
    raise exception 'that is a lot of names in an hour — give it a while'
      using errcode = 'check_violation';
  end if;

  insert into public.name_history (profile_id, name, held_from)
  values (v_id, v_current, v_since);

  update public.profiles
     set name = p_name, name_since = now()
   where id = v_id;

  -- The wall follows the name. Cascading on the foreign key above is what keeps
  -- every post on it addressable at the new one.
  update public.rooms set slug = '~' || p_name where owner_id = v_id;

  return p_name;
exception
  when unique_violation then
    raise exception '% is taken', p_name using errcode = 'unique_violation';
end;
$$;

revoke all on function public.change_name (citext) from public, anon;
grant execute on function public.change_name (citext) to authenticated;

-- The lobby ------------------------------------------------------------------
-- Unchanged except for the one clause that matters: walls are not rooms you
-- browse to. §3.11's proof of life is about a building with six doors, and a
-- door per person is a directory.
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
  and r.archived_at is null
  and r.owner_id is null;

-- Posting --------------------------------------------------------------------

create or replace function public.create_post (p_room citext, p_body text)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_no integer;
  v_post    public.posts;
  v_owner   uuid;
  v_exists  boolean;
  v_name    citext;
begin
  if auth.uid () is null then
    raise exception 'you have to be signed in to say something'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.require_can_contribute (auth.uid ());

  select owner_id, true into v_owner, v_exists
    from public.rooms where slug = p_room;

  -- Your own wall, made the first time you put something on it. Creating it at
  -- signup instead would leave everybody with an empty room they never asked
  -- for, and §5 is blunt that an empty room is worse than no room.
  if not coalesce(v_exists, false) and p_room ~ '^~' then
    select name into v_name from public.profiles where id = auth.uid ();
    if v_name is null or p_room <> ('~' || v_name)::citext then
      raise exception 'no room called %', p_room using errcode = 'no_data_found';
    end if;

    insert into public.rooms (slug, gloss, ephemeral, sort_order, owner_id)
    values (p_room, 'what ' || v_name || ' is saying', false, 1000, auth.uid ());
    v_owner := auth.uid ();
  end if;

  -- Somebody else's wall is theirs to start things on. Replying is open to
  -- everyone, which is the whole point of it being a wall rather than a diary —
  -- and that goes through the replies table, not through here.
  if v_owner is not null and v_owner <> auth.uid () then
    raise exception 'this is somebody else''s wall — you can reply to what is here, but only they can post to it'
      using errcode = 'insufficient_privilege';
  end if;

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

-- Decay skips walls: a quiet wall is a person who has not posted lately, which
-- is not a room going cold and is nobody's business to tidy up (§4.2).
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
     and r.owner_id is null
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
