-- Moving an existing project's contents to a new Supabase account.
--
-- Only needed if the old project has real accounts and posts you want to keep.
-- A move with nothing worth keeping is simpler: run supabase/setup.sql on the
-- new project, point the app at it, and stop reading here.
--
--
-- HOW THIS IS MEANT TO BE USED
--
--   1. On the NEW project: run supabase/setup.sql. Schema, grants, and the §5
--      seed. Confirm every room in the printout has posts in it.
--   2. On the OLD project: run PART ONE below. It prints INSERT statements.
--   3. Copy that output. Run it on the NEW project.
--   4. Run PART THREE on the new project to check the two agree.
--
-- The seeded accounts and rooms exist on both sides and are skipped throughout
-- — `on conflict do nothing` on the way in, and the `.invalid` addresses are
-- excluded on the way out. Seeded post numbers do not collide with real ones
-- because the seed's allocator update runs before any of this.
--
--
-- THE ONE THING TO DECIDE FIRST
--
-- Every account here is passwordless — sign-in is a key in an inbox, and
-- `encrypted_password` is an empty string on every row. So there is nothing
-- secret to move, and nothing that breaks by moving it: an account is an id
-- and an email address, and both come across intact. People stay signed in
-- nowhere, because the new project mints its own JWT secret — everybody is
-- signed out by the move and gets back in with `login <name>`.
--
-- That is worth saying out loud to people before you do it, because from
-- inside it looks exactly like being logged out for no reason.
--
--
-- WHAT IS DELIBERATELY NOT MOVED
--
--   signup_attempts     rate-limit counters. Moving them carries somebody's
--                       hour-old "too many keys" across to a project that has
--                       sent them nothing. They refill by themselves.
--   applied_migrations  setup.sql writes it. Copying the old one is how you get
--                       a project that thinks it has a migration it does not.


-- ============================================================================
-- PART ONE — run this on the OLD project. It prints SQL; it changes nothing.
-- ============================================================================

-- The accounts. `auth.users` is the root of everything: `profiles.id` points at
-- it, and every post and reply points at a profile, so this has to land first
-- or every insert after it fails a foreign key.
--
-- The token columns are written as '' rather than left null on purpose. Auth
-- reads them into plain strings, and a NULL makes it fail with "converting NULL
-- to string is unsupported" on any query that touches the row — a hand-moved
-- account can break sign-in for everybody, not just itself.
select
  'insert into auth.users (id, instance_id, aud, role, email, encrypted_password,' ||
  ' email_confirmed_at, confirmation_token, recovery_token, email_change,' ||
  ' email_change_token_new, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)' ||
  ' values (' ||
  quote_literal(u.id::text) || '::uuid,' ||
  ' ''00000000-0000-0000-0000-000000000000'', ''authenticated'', ''authenticated'',' ||
  quote_literal(u.email) || ',' ||
  ' '''', ' || coalesce(quote_literal(u.email_confirmed_at::text) || '::timestamptz', 'null') || ',' ||
  ' '''', '''', '''', '''',' ||
  ' ''{"provider":"email","providers":["email"]}''::jsonb, ''{}''::jsonb,' ||
  quote_literal(u.created_at::text) || '::timestamptz, now())' ||
  ' on conflict (id) do nothing;'
from auth.users u
-- The five seed accounts are already on the new project, put there by
-- setup.sql, and they are the only `.invalid` addresses that exist.
where u.email not like '%@seed.invalid'
order by u.created_at;

-- The people. `mail_seen_at` comes across because leaving it behind marks every
-- reply anybody ever received as unread — a badge saying 40 on somebody's first
-- visit to a site they have just been mysteriously signed out of.
select
  'insert into public.profiles (id, name, created_at, verified_at, mail_seen_at,' ||
  ' banned_at, terms_accepted_at) values (' ||
  quote_literal(p.id::text) || '::uuid,' ||
  quote_literal(p.name::text) || ',' ||
  quote_literal(p.created_at::text) || '::timestamptz,' ||
  coalesce(quote_literal(p.verified_at::text) || '::timestamptz', 'null') || ',' ||
  coalesce(quote_literal(p.mail_seen_at::text) || '::timestamptz', 'null') || ',' ||
  coalesce(quote_literal(p.banned_at::text) || '::timestamptz', 'null') || ',' ||
  coalesce(quote_literal(p.terms_accepted_at::text) || '::timestamptz', 'null') || ')' ||
  ' on conflict (id) do nothing;'
from public.profiles p
join auth.users u on u.id = p.id
where u.email not like '%@seed.invalid'
order by p.created_at;

-- Rooms people made, and walls. Curated rooms are already there from the seed.
--
-- `next_post_no` is carried rather than recomputed, because §3.4 says an address
-- is never reused — and a room whose counter is reset to max+1 after a post was
-- hidden hands the next person an address somebody else already had.
select
  'insert into public.rooms (slug, gloss, ephemeral, sort_order, created_by, owner_id,' ||
  ' from_room, curated, next_post_no, created_at, archived_at, hidden_at) values (' ||
  quote_literal(r.slug::text) || '::citext,' ||
  quote_literal(r.gloss) || ',' ||
  r.ephemeral || ',' || r.sort_order || ',' ||
  coalesce(quote_literal(r.created_by::text) || '::uuid', 'null') || ',' ||
  coalesce(quote_literal(r.owner_id::text) || '::uuid', 'null') || ',' ||
  coalesce(quote_literal(r.from_room::text) || '::citext', 'null') || ',' ||
  r.curated || ',' || r.next_post_no || ',' ||
  quote_literal(r.created_at::text) || '::timestamptz,' ||
  coalesce(quote_literal(r.archived_at::text) || '::timestamptz', 'null') || ',' ||
  coalesce(quote_literal(r.hidden_at::text) || '::timestamptz', 'null') || ')' ||
  ' on conflict (slug) do nothing;'
from public.rooms r
where r.created_by is not null or r.owner_id is not null
order by r.created_at;

-- Posts. Not the seeded ones, and not commons — commons keeps nothing (§3.10),
-- so carrying a day of it across would be the one place this site is
-- structurally incapable of holding on to something, holding on to something.
--
-- **Deliberately without `id`.** The first version of this carried `posts.id`
-- across and conflicted on it, which is a trap: both projects run the same
-- seed, so the new one already owns ids 1..21, and a real post that happened to
-- land on id 22 fits only by luck. One extra seeded row on either side and
-- `on conflict (id) do nothing` throws a real person's post away and reports
-- success. Data loss that looks like it worked is the worst thing this file
-- could do.
--
-- So the natural key is used instead: `(room_slug, post_no)`, which is the
-- address §3.4 says is permanent and never reused. The sequence assigns the id
-- on the way in, replies find their post by address below, and nothing depends
-- on two databases having counted to the same number.
select
  'insert into public.posts (room_slug, post_no, author_id, body, created_at, hidden_at)' ||
  ' values (' ||
  quote_literal(p.room_slug::text) || '::citext,' ||
  p.post_no || ',' ||
  quote_literal(p.author_id::text) || '::uuid,' ||
  quote_literal(p.body) || ',' ||
  quote_literal(p.created_at::text) || '::timestamptz,' ||
  coalesce(quote_literal(p.hidden_at::text) || '::timestamptz', 'null') || ')' ||
  ' on conflict (room_slug, post_no) do nothing;'
from public.posts p
join public.rooms r on r.slug = p.room_slug
-- No filter on the author, and that is a correction rather than an oversight.
-- Filtering seed accounts out here also throws away anything the operator wrote
-- with `moderate.sh post-as`, which writes under a real name and is the
-- documented way to warm a room — §5's whole "the demo cannot launch to a ghost
-- town". The seed's own posts are skipped by the conflict clause instead, since
-- they are at the same address on both sides, and that is a rule about what is
-- already there rather than a guess about who wrote it.
where not r.ephemeral
order by p.room_slug, p.post_no;

-- Replies, found by their post's address rather than by an id, for the reason
-- above. Note this does NOT skip replies on seeded posts: somebody answering
-- the seeded music/12 wrote that, and it is theirs.
--
-- Replies have no natural key, so the guard is the one seed.sql already uses —
-- same post, same author, same words. Two people posting identical words on the
-- same post is the only thing it would collapse, and it is worth that to make
-- the paste safe to run twice, which is what people do when they are not sure
-- it worked the first time.
select
  'insert into public.replies (post_id, author_id, body, created_at, hidden_at)' ||
  ' select p.id, ' || quote_literal(x.author_id::text) || '::uuid, ' ||
  quote_literal(x.body) || ', ' ||
  quote_literal(x.created_at::text) || '::timestamptz, ' ||
  coalesce(quote_literal(x.hidden_at::text) || '::timestamptz', 'null') ||
  ' from public.posts p where p.room_slug = ' || quote_literal(parent.room_slug::text) ||
  '::citext and p.post_no = ' || parent.post_no ||
  ' and not exists (select 1 from public.replies e where e.post_id = p.id and e.author_id = ' ||
  quote_literal(x.author_id::text) || '::uuid and e.body = ' || quote_literal(x.body) || ');'
from public.replies x
join public.posts parent on parent.id = x.post_id
join public.rooms r on r.slug = parent.room_slug
-- Same again: the seed's own replies are skipped by the `not exists` guard the
-- generated statement carries, because they are identical on both sides.
where not r.ephemeral
order by x.id;

-- Who used to be called what. §4.6's whole mitigation for a name changing hands
-- is that the *reader* is told, and this table is where that is known. Leaving
-- it behind silently un-warns everybody.
select
  'insert into public.name_history (profile_id, name, released_at) select ' ||
  quote_literal(h.profile_id::text) || '::uuid,' ||
  quote_literal(h.name::text) || ',' ||
  quote_literal(h.released_at::text) || '::timestamptz' ||
  ' where not exists (select 1 from public.name_history e where e.profile_id = ' ||
  quote_literal(h.profile_id::text) || '::uuid and e.name = ' ||
  quote_literal(h.name::text) || '::citext);'
from public.name_history h
order by h.id;

-- Who asked for the daily email. Opt-in, so failing to carry it is a promise
-- broken in the safe direction — but it is still a preference somebody set.
select
  'insert into public.notify_settings (profile_id, daily, token, notified_at) values (' ||
  quote_literal(n.profile_id::text) || '::uuid,' ||
  n.daily || ',' ||
  quote_literal(n.token::text) || '::uuid,' ||
  coalesce(quote_literal(n.notified_at::text) || '::timestamptz', 'null') || ')' ||
  ' on conflict (profile_id) do nothing;'
from public.notify_settings n
order by n.profile_id;


-- ============================================================================
-- PART TWO — run this on the NEW project, AFTER pasting part one's output.
-- ============================================================================
--
-- The four sequences. `posts.id` and `replies.id` were inserted with explicit
-- values above, which does not advance the sequence behind them — so without
-- this the very next real post gets id 1 and collides with something moved.
--
-- This is the single likeliest thing to forget and the one with the worst
-- symptom: the site works, somebody posts, and it fails on a duplicate key.

select setval('public.posts_id_seq',
  coalesce((select max(id) from public.posts), 0) + 1, false);
select setval('public.replies_id_seq',
  coalesce((select max(id) from public.replies), 0) + 1, false);
select setval('public.name_history_id_seq',
  coalesce((select max(id) from public.name_history), 0) + 1, false);
select setval('public.signup_attempts_id_seq',
  coalesce((select max(id) from public.signup_attempts), 0) + 1, false);

-- Every room's allocator above every address it has handed out, seeded rooms
-- included. Carried values win where they are higher, which is the point:
-- §3.4 says an address is never reused, and a hidden post leaves a gap that
-- max(post_no) cannot see.
update public.rooms r
   set next_post_no = greatest(
     r.next_post_no,
     coalesce((select max(p.post_no) + 1 from public.posts p where p.room_slug = r.slug), 1)
   );


-- ============================================================================
-- PART THREE — run on BOTH, and compare the two printouts by eye.
-- ============================================================================
--
-- Counts differ by the seed on a project that had one, so the useful comparison
-- is real accounts and real posts. If these match and the room list matches,
-- the move landed.

select 'accounts'      as what, count(*) as n from public.profiles p
  join auth.users u on u.id = p.id where u.email not like '%@seed.invalid'
union all
select 'rooms made',    count(*) from public.rooms
  where created_by is not null
union all
select 'walls',         count(*) from public.rooms where owner_id is not null
union all
select 'posts kept',    count(*) from public.posts p
  join public.rooms r on r.slug = p.room_slug where not r.ephemeral
union all
select 'replies',       count(*) from public.replies
union all
select 'names released', count(*) from public.name_history
union all
select 'email opt-ins', count(*) from public.notify_settings where daily
order by what;

-- And the thing that actually breaks if part two was skipped.
--
-- Answered yes/no rather than as two numbers to compare. `last_value` means
-- different things depending on whether the sequence has been called yet, so
-- the raw pair reads as a mismatch on a project where nothing is wrong — and
-- an operator who has just moved a database does not need a puzzle. The only
-- question that matters is whether the next id handed out is free.
select
  case when (select last_value from public.posts_id_seq)
            > coalesce((select max(id) from public.posts), 0)
       then 'posts: sequence is clear'
       else 'posts: SEQUENCE WILL COLLIDE — run part two' end as check
union all
select
  case when (select last_value from public.replies_id_seq)
            > coalesce((select max(id) from public.replies), 0)
       then 'replies: sequence is clear'
       else 'replies: SEQUENCE WILL COLLIDE — run part two' end
union all
-- Every room's allocator above every address in it, which is §3.4's
-- never-reused promise stated as something you can look at.
select
  case when not exists (
         select 1 from public.rooms r
          where r.next_post_no <= coalesce(
            (select max(p.post_no) from public.posts p where p.room_slug = r.slug), 0)
       )
       then 'addresses: every room allocator is clear'
       else 'addresses: A ROOM WILL REUSE AN ADDRESS — run part two' end;
