-- feed — everything people are putting on their own walls, in one place.
--
-- Walls are deliberately absent from the lobby: §4.2's "forty rooms with three
-- people each kills the entire feeling" is exactly what a door per person does
-- to a room list. That mitigation worked, and it left a hole. A wall is only
-- ever found by already knowing whose it is, so anything said on one reaches
-- the people who thought to go and look, which for most walls is nobody.
--
-- feed closes it without reopening the thing §4.2 warned about: one room, in
-- the lobby, holding what is on every wall — so the walls stay out of the
-- listing and what is said on them does not go unread.
--
-- It is a real room row rather than a client-side invention, so that /feed is
-- an address, the lobby lists it with a gloss like everything else, and search
-- finds it. What it is *not* is somewhere posts live: nothing is ever written
-- to feed, and the function below reads them from the walls they are on. Every
-- line in it carries a `~name/12` address that is the real one.

insert into public.rooms (slug, gloss, ephemeral, sort_order, curated)
values ('feed', 'what people are saying on their own walls', false, 6, true)
on conflict (slug) do nothing;

-- Curated, so it never fades out of the lobby, and sorted after the rooms that
-- were there first.
update public.rooms
   set curated = true, sort_order = 6, gloss = 'what people are saying on their own walls'
 where slug = 'feed';

insert into public.reserved_slugs (slug, reason)
values ('feed', 'that is the wall feed')
on conflict (slug) do nothing;

-- Nothing is ever posted into it -----------------------------------------------
--
-- feed is a view of walls. A post written *to* feed would sit in a room that
-- shows everything except itself, with an address nobody could reason about, so
-- create_post refuses it — and says the thing somebody meant, which is that
-- their own wall is where this goes.
create or replace function public.create_post (p_room citext, p_body text)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post   public.posts;
  v_no     integer;
  v_exists boolean;
  v_owner  uuid;
  v_name   citext;
begin
  perform public.require_can_contribute (auth.uid ());

  if p_room = 'feed' then
    raise exception 'feed shows what people put on their own walls. put this on yours: go ~%',
      coalesce((select name from public.profiles where id = auth.uid ()), 'yourname')
      using errcode = 'insufficient_privilege';
  end if;

  select true, r.owner_id into v_exists, v_owner
    from public.rooms r where r.slug = p_room and r.hidden_at is null;

  -- A wall makes itself, on the first thing its owner puts there, and only for
  -- the owner's own name (see the walls migration).
  if not coalesce(v_exists, false) and p_room ~ '^~' then
    select name into v_name from public.profiles where id = auth.uid ();
    if v_name is null or p_room <> ('~' || v_name)::citext then
      raise exception 'no room called %', p_room using errcode = 'no_data_found';
    end if;

    insert into public.rooms (slug, gloss, ephemeral, sort_order, owner_id)
    values (p_room, 'what ' || v_name || ' is saying', false, 1000, auth.uid ());
    v_owner := auth.uid ();
    v_exists := true;
  end if;

  if not coalesce(v_exists, false) then
    raise exception 'no room called %', p_room using errcode = 'no_data_found';
  end if;

  if v_owner is not null and v_owner <> auth.uid () then
    raise exception 'this is somebody else''s wall — you can reply to what is here, but only they can post to it'
      using errcode = 'insufficient_privilege';
  end if;

  update public.rooms
     set next_post_no = next_post_no + 1,
         archived_at  = null
   where slug = p_room
  returning next_post_no - 1 into v_no;

  insert into public.posts (room_slug, post_no, author_id, body)
  values (p_room, v_no, auth.uid (), p_body)
  returning * into v_post;

  return v_post;
end;
$$;

revoke all on function public.create_post (citext, text) from public, anon;
grant execute on function public.create_post (citext, text) to authenticated;

-- Reading it -------------------------------------------------------------------
--
-- Every row carries the address it actually lives at, because that is the only
-- way back to it: post numbers are allocated per room, so `2` on the feed is
-- ambiguous and `~marisol/2` is not.
create or replace function public.wall_feed (p_limit integer default 40)
returns table (
  room       citext,
  post_no    integer,
  author     citext,
  body       text,
  created_at timestamptz,
  replies    bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select p.room_slug, p.post_no, author.name, p.body, p.created_at,
         coalesce(counted.n, 0)
    from public.posts p
    join public.rooms r on r.slug = p.room_slug
    join public.profiles author on author.id = p.author_id
    left join lateral (
      select count(*) as n
        from public.replies rep
       where rep.post_id = p.id and rep.hidden_at is null
    ) counted on true
   -- Walls only. `owner_id is not null` is what makes a room one.
   where r.owner_id is not null
     and r.hidden_at is null
     and r.archived_at is null
     and p.hidden_at is null
     and author.banned_at is null
   order by p.created_at desc
   limit greatest(1, least(coalesce(p_limit, 40), 100));
$$;

grant execute on function public.wall_feed (integer) to anon, authenticated;

-- The lobby line for it --------------------------------------------------------
--
-- Without this the feed row has no posts of its own and the lobby says "quiet
-- in here" under it, which is both wrong and the §5 failure mode — a door that
-- advertises an empty room is worse than no door.
--
-- So the lateral that finds a room's newest post looks at walls when the row is
-- the feed, and at the room itself otherwise.
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
  r.curated
from public.rooms r
left join lateral (
  select p.body, p.created_at, p.author_id
    from public.posts p
    join public.rooms pr on pr.slug = p.room_slug
   where (
           -- Same filters `wall_feed` uses, or the lobby advertises a post the
           -- feed itself will not show.
           (r.slug = 'feed' and pr.owner_id is not null
              and pr.hidden_at is null and pr.archived_at is null)
           or (r.slug <> 'feed' and p.room_slug = r.slug)
         )
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
