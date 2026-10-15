-- Furniture is decided by name, not by who made the row.
--
-- Reported as: "some rooms exist but aren't showing up in the list of rooms in
-- the lobby, like builders" — on a project that *had* applied
-- 20260806000000_three_more_rooms.sql, which is the migration that was supposed
-- to prevent exactly this.
--
-- The bug is the test every repair used. Both the seed and that migration mark
-- the permanent set with
--
--     update public.rooms set curated = true
--      where owner_id is null and created_by is null;
--
-- `created_by is null` stands in for "this room was seeded". It is right for
-- every room the seed inserts and wrong for the same room made any other way —
-- and `builders` is the room most likely to have been made another way, because
-- it was added to the seed *after* launch. A project seeded before that never
-- got it from the seed, so it exists only if somebody typed `make builders`,
-- which stamps `created_by` and puts the row permanently outside every repair.
--
-- Uncurated is not cosmetic: a room that is not furniture drops out of the
-- lobby after fourteen days with nothing said in it. So the room is there,
-- `go builders` opens it, and the front page has quietly stopped listing it.
--
-- 20260806000000 saw this coming and fixed it for the three rooms it was adding
-- — `update ... where slug in ('crypto','movies','feedback')`, deliberately
-- unconditional. It just never went back for the seven that came before.
--
-- So: name them. The permanent set is a list of ten slugs, it is the same list
-- the lobby's order is written out in, and inferring it from a nullable column
-- has now been wrong twice. Anything else stays uncurated, which is correct —
-- rooms people make are meant to fade.

update public.rooms
   set curated = true
 where slug in (
   'commons', 'music', 'builders', 'poker', 'kitchen',
   'latenight', 'crypto', 'movies', 'feedback', 'feed'
 );

-- Commons is the one that keeps nothing (§3.10), and a hand-made room of that
-- name would have come out permanent. Every other room in the set is durable,
-- and `make` already creates durable rooms, so there is nothing to correct
-- there — stated for commons only rather than as a blanket `ephemeral = false`
-- that would quietly make commons permanent.
update public.rooms set ephemeral = true  where slug = 'commons';
update public.rooms set ephemeral = false where slug in (
  'music', 'builders', 'poker', 'kitchen',
  'latenight', 'crypto', 'movies', 'feedback', 'feed'
);

comment on column public.rooms.curated is
  'Furniture: always listed in the lobby, never fades for going quiet. Set by '
  'naming the slugs, in 20260907000000 — inferring the set from who made the '
  'row missed a seeded room remade by hand, which then left the front page.';
