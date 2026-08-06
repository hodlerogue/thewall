-- Two more permanent rooms, and a tidy-up of the order they sit in.
--
-- The curated set is the furniture (§3.11): rooms that are always there, never
-- fade out of the listing for going quiet, and make the lobby read the same way
-- each time you walk in. Anybody verified can make a room (§4.2 as revised),
-- but a room somebody makes drops out of the listing after a fortnight of
-- silence — these do not, and that is the entire difference.
--
-- crypto and movies were asked for by name. Both are ordinary topic rooms; the
-- only thing making them different from a room a person opens is `curated`.
--
-- Glosses follow §5's shape: a room is an invitation to tell somebody
-- something, not a category. "what you cooked" gets a story out of people in a
-- way "food" does not, so these are "what you are holding" and "what you
-- watched" rather than "cryptocurrency" and "film".

insert into public.rooms (slug, gloss, ephemeral, sort_order, curated) values
  ('crypto', 'what you are holding', false, 6, true),
  ('movies', 'what you watched',     false, 7, true)
on conflict (slug) do nothing;

-- `on conflict do nothing` means an existing row keeps whatever it had, which
-- for a room somebody had already made under one of these names would leave it
-- uncurated and fading. Stated separately so the outcome does not depend on
-- which of those two happened.
update public.rooms
   set curated = true, ephemeral = false
 where slug in ('crypto', 'movies');

update public.rooms set gloss = 'what you are holding', sort_order = 6 where slug = 'crypto';
update public.rooms set gloss = 'what you watched',    sort_order = 7 where slug = 'movies';

-- The order, set out in full ---------------------------------------------------
--
-- `feed` was on 6, which was last until this migration and would otherwise have
-- ended up in the middle of the topic rooms.
--
-- The rest matches the block at the end of the seed, which is the only thing
-- that has ever decided this: `seed.sql`'s *insert* has `poker` and `builders`
-- both on 2, and has since builders was added — harmless only because the
-- update underneath it fixes them. A live project seeded before this has the
-- fixed order already; one seeded and never re-run might not.
--
-- Written as one block rather than as edits to the two that moved, so the
-- answer to "what order is the lobby in" is this list and not this list plus
-- three previous migrations.
update public.rooms set sort_order = 0 where slug = 'commons';
update public.rooms set sort_order = 1 where slug = 'music';
update public.rooms set sort_order = 2 where slug = 'builders';
update public.rooms set sort_order = 3 where slug = 'poker';
update public.rooms set sort_order = 4 where slug = 'kitchen';
update public.rooms set sort_order = 5 where slug = 'latenight';
-- crypto 6 and movies 7 are set above.
update public.rooms set sort_order = 8 where slug = 'feed';

-- Every seeded room is curated. The column defaults to false, which is right
-- for a room somebody opens and wrong for every room in this list — and a
-- seeded room left unmarked would fade out of the lobby after a fortnight of
-- quiet, which is the one thing furniture must never do. Repeated from the seed
-- because the seed only ever runs on a fresh database.
update public.rooms
   set curated = true
 where owner_id is null
   and created_by is null;
