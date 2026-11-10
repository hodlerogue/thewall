-- A room that grew out of another one is listed there, not in the lobby.
--
-- `from_room` was a label the lobby ignored, so a room made from inside music
-- took a lobby slot beside music for as long as anybody talked in it. §4.2 is
-- about exactly that: the lobby is the first impression, and subtopics of rooms
-- already on it are the thinnest thing it could be showing. They have a place
-- to be listed — the bottom of the room they came from.
--
-- `go`, `find --rooms` and the parent's list do not read this view, so all
-- three still reach them.
--
-- **The exception is the point of the helper.** A parent that has faded or been
-- hidden is not somewhere anybody will find a list, and a lively child of one
-- would be on no list at all. So a child stays off the lobby only while its
-- parent is alive, and comes back when the parent is not. "Alive" and not "in
-- the lobby" on purpose: the second would recurse up the chain, and a grandchild
-- is reachable through a living child whether or not that child is listed.
--
-- Applies to rooms that already exist, for one rule rather than two.
--
-- Safe in either order with the deploy. The app asks for the same columns from
-- `room_overview` as before, and treats `find_rooms`' new column as optional.

create or replace function public.room_is_alive (p_slug citext)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.rooms r
     where r.slug = p_slug
       and r.hidden_at is null
       and r.archived_at is null
       and (
         r.curated
         or coalesce(
              (select max(p.created_at)
                 from public.posts p
                where p.room_slug = r.slug
                  and p.hidden_at is null
                  and public.is_visible (p.room_slug, p.created_at)),
              r.created_at
            ) > now() - interval '14 days'
       )
  );
$$;

revoke all on function public.room_is_alive (citext) from public;
grant execute on function public.room_is_alive (citext) to anon, authenticated;

create or replace view public.room_overview
with (security_invoker = true) as
select
  r.slug,
  r.gloss,
  r.ephemeral,
  r.sort_order,
  -- One of the two is always null: the guards are mutually exclusive, so
  -- coalesce is a choice between them rather than a fallback.
  coalesce(own.body, feed.body)             as latest_body,
  coalesce(own.created_at, feed.created_at) as latest_at,
  coalesce(own_author.name, feed_author.name) as latest_author,
  r.curated
from public.rooms r

-- An ordinary room: its own newest post. See 20260810000000 for why these are
-- two laterals with the guard inside.
left join lateral (
  select p.body, p.created_at, p.author_id
    from public.posts p
   where r.slug <> 'feed'
     and p.room_slug = r.slug
     and p.hidden_at is null
     and public.is_visible (p.room_slug, p.created_at)
   order by p.created_at desc
   limit 1
) own on true

-- The feed: the newest thing on anybody's wall.
left join lateral (
  select p.body, p.created_at, p.author_id
    from public.posts p
    join public.rooms pr on pr.slug = p.room_slug
   where r.slug = 'feed'
     and pr.owner_id is not null
     and pr.hidden_at is null
     and pr.archived_at is null
     and p.hidden_at is null
     and public.is_visible (p.room_slug, p.created_at)
   order by p.created_at desc
   limit 1
) feed on true

left join public.profiles own_author on own_author.id = own.author_id
left join public.profiles feed_author on feed_author.id = feed.author_id
where r.hidden_at is null
  and r.archived_at is null
  and r.owner_id is null
  and (
    r.curated
    or coalesce(own.created_at, r.created_at) > now() - interval '14 days'
  )
  and (
    -- Furniture is listed whatever it says about itself.
    r.curated
    or r.from_room is null
    or not public.room_is_alive (r.from_room)
  );

-- find_rooms says which rooms are off the lobby, so it has to use the same rule,
-- and says where a grown-out one lives so the reason it prints is the true one.
-- Dropped and recreated because a return type cannot be changed in place.
drop function if exists public.find_rooms (text, integer);

create function public.find_rooms (p_term text, p_limit integer default 20)
returns table (
  slug        citext,
  gloss       text,
  curated     boolean,
  in_lobby    boolean,
  latest_at   timestamptz,
  post_count  bigint,
  listed_in   citext
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
    r.archived_at is null
      and (
        r.curated
        or coalesce(newest.at, r.created_at) > now() - interval '14 days'
      )
      and (r.curated or lineage.living_parent is null),
    newest.at,
    coalesce(counted.n, 0),
    lineage.living_parent
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
  left join lateral (
    select case when public.room_is_alive (r.from_room) then r.from_room end as living_parent
  ) lineage on true
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

revoke all on function public.find_rooms (text, integer) from public;
grant execute on function public.find_rooms (text, integer) to anon, authenticated;

-- The parent's list is now the main way to these rooms and it shows eight, so
-- the eight had better be the ones with people in them. It was oldest first,
-- which cut off exactly the rooms somebody had just made.
create or replace function public.rooms_from (p_slug citext)
returns table (slug citext, gloss text)
language sql
stable
security definer
set search_path = public
as $$
  select r.slug, r.gloss
    from public.rooms r
    left join lateral (
      select max(p.created_at) as at
        from public.posts p
       where p.room_slug = r.slug and p.hidden_at is null
    ) newest on true
   where r.from_room = p_slug
     and r.hidden_at is null
   order by coalesce(newest.at, r.created_at) desc, r.slug;
$$;
