-- The lobby stops reading every post on the site to draw itself.
--
-- Asked what happens to the lobby at hundreds of rooms. Built one with 310 and
-- measured: **1112 ms**, on every page load, to show twelve rooms.
--
-- The cause is one `or`. `room_overview` finds each room's newest post with a
-- lateral join, and when `feed` was added — a room that holds nothing itself and
-- whose lobby line has to come from everybody's walls — the two cases were
-- folded into a single predicate:
--
--   where ( (r.slug = 'feed' and pr.owner_id is not null and ...)
--           or (r.slug <> 'feed' and p.room_slug = r.slug) )
--
-- `p.room_slug = r.slug` is exactly what `posts_room_recent (room_slug,
-- created_at desc)` is for. Sitting inside an `or`, it stops being usable:
-- Postgres cannot know which branch applies until it has the row, so it
-- sequentially scans **every post on the site, once per room**. The plan says
-- so plainly — `Seq Scan on posts ... loops=310`, `Rows Removed by Join Filter:
-- 320`. That is rooms × posts, and it grows with the product of the two.
--
-- Nothing was wrong with the *answer*. It has always been right, and it was
-- fast at nine rooms, which is why nothing caught it: the cost is invisible
-- until the site works.
--
-- Split into two laterals, each guarded on the outer row, so the ordinary path
-- gets its index back and the feed path runs for the one row it is about.
-- Same query, measured again on the same 310 rooms: **5.9 ms**.

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

-- An ordinary room: its own newest post.
--
-- `r.slug <> 'feed'` sits *inside* the subquery rather than in a join
-- condition. In the ON clause the lateral would still be executed and then
-- discarded; here it is a one-time filter on the outer row, and
-- `p.room_slug = r.slug` is left alone as the only predicate the index has to
-- serve.
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
--
-- Same filters `wall_feed` uses, or the lobby advertises a post the feed itself
-- will not show. Runs for one row of the whole query.
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
  );

comment on view public.room_overview is
  'The lobby (§3.11). One row per listable room with its newest post. Two '
  'laterals rather than one predicate with an or in it — the or made this '
  'rooms x posts, see the migration.';

-- An index the fade in the WHERE clause can use once there are enough rooms for
-- the sequential scan over `rooms` to matter. Cheap, and the query already
-- filters on exactly these three.
create index if not exists rooms_listable
  on public.rooms (curated, sort_order)
  where hidden_at is null and archived_at is null and owner_id is null;
