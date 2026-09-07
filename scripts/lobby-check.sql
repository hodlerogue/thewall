-- Why a room is, or is not, in the lobby.
--
-- For the question "this room exists, so where is it?". Reported about
-- `builders`, which on a fresh database is furniture and always listed — so a
-- live project where it has gone missing has drifted from one of the rules
-- below, and this says which.
--
-- Read-only. Paste it into Supabase's SQL Editor (New query → Run), or:
--
--   DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
--     psql "$DATABASE_URL" -f scripts/lobby-check.sql
--
-- The five reasons a room is not listed, in the order they are checked:
--
--   hidden      an operator hid it (§6). Gone from every surface, deliberately.
--   archived    same, for a room that was closed rather than moderated.
--   a wall      `~name` is somebody's page, not a room. Never in the lobby.
--   faded       nothing said in it for 14 days, and it is not furniture. This
--               is the one that surprises people: the room is fine, still
--               reachable by name, and simply not on the front page.
--   over budget the lobby prints every curated room and the six liveliest of
--               the rest. This is decided in the browser, not here, so a room
--               marked "in the lobby" below can still be one of the six that
--               did not fit — the lobby says "N more rooms" when that happens.
--
-- Furniture never fades. That is the whole of what `curated` buys, and every
-- seeded room is meant to have it: the seed sets it, and
-- 20260806000000_three_more_rooms.sql sets it again for anything seeded before
-- the column existed. A seeded room showing `curated=false` here means that
-- migration has not been applied — `./scripts/db-check.sh` will say so.

select
  r.slug,
  r.curated as furniture,
  coalesce(
    (select max(p.created_at) from public.posts p
      where p.room_slug = r.slug and p.hidden_at is null),
    r.created_at
  )::date as last_spoken,
  case
    when r.hidden_at is not null   then 'hidden by an operator'
    when r.archived_at is not null then 'archived'
    when r.owner_id is not null    then 'a wall, not a room'
    when r.curated                 then 'in the lobby — furniture, never fades'
    when coalesce(
           (select max(p.created_at) from public.posts p
             where p.room_slug = r.slug and p.hidden_at is null),
           r.created_at
         ) > now() - interval '14 days'
      then 'in the lobby — something said recently'
    else 'FADED — quiet 14 days and not furniture. still reachable: go ' || r.slug
  end as why
from public.rooms r
order by r.owner_id is not null, r.curated desc, r.sort_order, r.slug;
