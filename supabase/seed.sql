-- Cold start (§5).
--
-- "An empty room is worse than no room. The demo cannot launch to a ghost
-- town." So the rooms arrive warm, and what is written here follows §5 to the
-- letter: content that reads like ordinary people — a broken AC, a bad beat, a
-- dad's records in the garage, four pounds of tomatoes — and explicitly NOT dev
-- in-jokes, which §5 names as the first draft's failure and the thing that
-- narrows the audience to people who already like terminals.

-- Seed accounts, so the seeded posts have real authors. There is no password
-- and the addresses are .invalid, so nobody can sign in as them.
--
-- If this statement is REFUSED on a hosted project ("permission denied for
-- table users"), that is the auth schema being owned by supabase_auth_admin
-- rather than by the role in your connection string. It is the one step here
-- that a hosted project can reject, and it stops the whole seed, which leaves
-- you with a schema and no rooms.
--
-- The fix is to create the five accounts through the Auth admin API instead
-- and then re-run the seed. The API assigns its own ids, so the literal UUIDs
-- below would need to become lookups by email — ask for that change rather
-- than hand-editing, since the ids are referenced from four places.
--
-- The local path (`supabase start`) is not affected: the CLI seeds as an owner.
--
-- The empty strings are not decoration. Auth reads these token columns into
-- plain strings, and a NULL makes it fail with "converting NULL to string is
-- unsupported" on any query that touches the row — which means hand-seeded
-- users can break sign-in for everybody, not just themselves. Writing '' is
-- what the admin API would have done.
insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select
  id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
  '', now(),
  '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'jameson@seed.invalid'),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'marisol@seed.invalid'),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'tuck@seed.invalid'),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'ren@seed.invalid'),
  ('55555555-5555-4555-8555-555555555555'::uuid, 'dev@seed.invalid')
) as seed (id, email)
on conflict (id) do nothing;

insert into public.profiles (id, name) values
  ('11111111-1111-4111-8111-111111111111', 'jameson'),
  ('22222222-2222-4222-8222-222222222222', 'marisol'),
  ('33333333-3333-4333-8333-333333333333', 'tuck'),
  ('44444444-4444-4444-8444-444444444444', 'ren'),
  ('55555555-5555-4555-8555-555555555555', 'dev')
on conflict (id) do nothing;

-- §4.2 — a fixed, curated set at launch. Room creation stays closed and the
-- decay rules stay written-but-unenabled, because 40 rooms with three people
-- each kills the entire feeling and the room list is the first impression.
insert into public.rooms (slug, gloss, ephemeral, sort_order) values
  ('commons',   'everything, briefly',        true,  0),
  ('music',     'what you are listening to',  false, 1),
  ('poker',     'bad beats and good folds',   false, 2),
  ('kitchen',   'what you cooked',            false, 3),
  -- §5 — one room should be a mood, not a topic. Mood rooms are what make this
  -- feel like a place rather than a forum.
  ('latenight', 'quiet hours only',           false, 4)
on conflict (slug) do nothing;

-- Posts are inserted directly here rather than through create_post(), because
-- the seed runs without an auth context. The room counters are advanced by hand
-- at the end so the allocator picks up exactly where the seed left off.
insert into public.posts (room_slug, post_no, author_id, body, created_at) values
  ('commons', 1, '22222222-2222-4222-8222-222222222222',
   'the AC in my building has been out for three days and the super keeps saying "tomorrow"',
   now() - interval '20 minutes'),
  ('commons', 2, '55555555-5555-4555-8555-555555555555',
   'four pounds of tomatoes from one plant. i have no plan for any of them.',
   now() - interval '64 minutes'),

  ('music', 11, '44444444-4444-4444-8444-444444444444',
   'the bass player at the bar last night was carrying the entire band and knew it',
   now() - interval '6 hours'),
  ('music', 12, '11111111-1111-4111-8111-111111111111',
   'found my dad''s records in the garage. half of them are warped and i am keeping all of them anyway.',
   now() - interval '2 hours'),

  ('poker', 1, '33333333-3333-4333-8333-333333333333',
   'flopped a set, lost to runner-runner clubs, and then tipped the dealer anyway because i am a gentleman',
   now() - interval '3 hours'),
  ('poker', 2, '11111111-1111-4111-8111-111111111111',
   'folded pocket kings face up and i would do it again',
   now() - interval '9 hours'),

  ('kitchen', 1, '55555555-5555-4555-8555-555555555555',
   'made stock from a chicken carcass for the first time and now i understand why my grandmother never threw anything out',
   now() - interval '5 hours'),
  ('kitchen', 2, '22222222-2222-4222-8222-222222222222',
   'the trick with the tomatoes is you roast them all at once and freeze whatever you do not eat',
   now() - interval '40 minutes'),

  ('latenight', 1, '44444444-4444-4444-8444-444444444444',
   'anyone else awake or is it just me and the refrigerator',
   now() - interval '8 hours'),
  ('latenight', 2, '33333333-3333-4333-8333-333333333333',
   'the 3am version of a problem is never the real size of the problem',
   now() - interval '30 hours')
on conflict do nothing;

-- The column types come from the VALUES list, which is all text, so each one is
-- cast explicitly on the way in.
-- Unlike the inserts above, replies have no natural key to conflict on, so
-- re-running the seed would quietly double them. The guard makes the whole
-- file safe to run more than once, which matters because running it is the
-- step people repeat while working out why a project looks empty.
insert into public.replies (post_id, author_id, body, created_at)
select p.id, v.author_id::uuid, v.body, v.created_at
  from (values
    ('music', 12, '22222222-2222-4222-8222-222222222222',
     'warped ones still play, they just wobble. it grows on you.', now() - interval '70 minutes'),
    ('music', 12, '33333333-3333-4333-8333-333333333333',
     'what was in there', now() - interval '44 minutes'),
    ('poker', 1, '11111111-1111-4111-8111-111111111111',
     'the tip is the tell', now() - interval '2 hours'),
    ('latenight', 1, '22222222-2222-4222-8222-222222222222',
     'the refrigerator and i are also here', now() - interval '7 hours'),
    ('kitchen', 1, '44444444-4444-4444-8444-444444444444',
     'freeze it flat in bags, it stacks and it thaws in about a minute', now() - interval '4 hours')
  ) as v (room_slug, post_no, author_id, body, created_at)
  join public.posts p
    on p.room_slug = v.room_slug::citext
   and p.post_no = v.post_no
 where not exists (
   select 1 from public.replies existing
    where existing.post_id = p.id
      and existing.body = v.body
 );

-- §3.4 — leave the allocator above every number the seed used, so the first
-- real post continues the sequence instead of colliding with it.
update public.rooms r
   set next_post_no = coalesce(
     (select max(p.post_no) + 1 from public.posts p where p.room_slug = r.slug),
     1
   );
