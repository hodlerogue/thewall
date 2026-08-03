-- Schema tests, run against the real migration.
--
-- These check the two properties the decision document treats as correctness
-- rather than preference — permanent post addresses (§3.4) and a commons that
-- keeps nothing (§3.10) — plus the RLS posture that makes reading anonymous
-- and writing accountable (§3.9).
--
-- Run with: npm run test:db

\set ON_ERROR_STOP on

create schema if not exists tests;

create or replace function tests.ok (condition boolean, what text)
returns void
language plpgsql
as $$
begin
  if condition then
    raise notice '  ok    %', what;
  else
    raise exception 'FAILED: %', what;
  end if;
end;
$$;

create or replace function tests.raises (statement text, what text)
returns void
language plpgsql
as $$
begin
  execute statement;
  raise exception 'FAILED: % (it was allowed)', what;
exception
  when others then
    if sqlerrm like 'FAILED:%' then
      raise;
    end if;
    raise notice '  ok    % [%]', what, left(sqlerrm, 60);
end;
$$;

-- RLS filters an UPDATE rather than rejecting it: a statement aimed at rows you
-- may not touch simply matches nothing. So "you cannot edit that" is checked as
-- "nothing changed", not as an error.
create or replace function tests.changes_nothing (statement text, what text)
returns void
language plpgsql
as $$
declare
  affected integer;
begin
  execute statement;
  get diagnostics affected = row_count;
  if affected = 0 then
    raise notice '  ok    % [0 rows]', what;
  else
    raise exception 'FAILED: % (% rows changed)', what, affected;
  end if;
end;
$$;

-- The assertions themselves run while impersonating anon/authenticated, so
-- those roles need to be able to call them.
grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- A real account to act as.
insert into auth.users (id, aud, role, email)
values ('99999999-9999-4999-8999-999999999999', 'authenticated', 'authenticated', 'tester@seed.invalid')
on conflict (id) do nothing;

-- Verified, because these tests are about everything other than verification;
-- the §4.7 rule has its own section at the end.
insert into public.profiles (id, name, verified_at)
values ('99999999-9999-4999-8999-999999999999', 'tester', now())
on conflict (id) do nothing;


\echo ''
\echo '§3.4 — post numbers are permanent addresses, never positions'

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';

  -- The seed leaves music at 13.
  select tests.ok((public.create_post('music', 'first')).post_no = 13, 'create_post allocates 13');
  select tests.ok((public.create_post('music', 'second')).post_no = 14, 'create_post allocates 14');
  select tests.ok((public.create_post('music', 'third')).post_no = 15, 'create_post allocates 15');
commit;

-- Delete the middle one. Nothing after it may shift.
delete from public.posts where room_slug = 'music' and post_no = 14;

select tests.ok(
  (select body from public.posts where room_slug = 'music' and post_no = 15) = 'third',
  'deleting 14 leaves 15 exactly where it was'
);

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';
  -- The gap is not refilled: 14 is spent forever.
  select tests.ok((public.create_post('music', 'fourth')).post_no = 16, 'the next post is 16, not the freed 14');
commit;

-- A reply aimed at 15 lands on 15, which is the bug §9 names.
insert into public.replies (post_id, author_id, body)
select id, '99999999-9999-4999-8999-999999999999', 'aimed at fifteen'
  from public.posts where room_slug = 'music' and post_no = 15;

select tests.ok(
  (select p.post_no
     from public.replies r join public.posts p on p.id = r.post_id
    where r.body = 'aimed at fifteen') = 15,
  'a reply to 15 is attached to 15'
);

select tests.ok(
  (select count(*) from (
     select room_slug, post_no from public.posts group by room_slug, post_no having count(*) > 1
   ) dupes) = 0,
  'no room ever holds the same address twice'
);


\echo ''
\echo '§3.10 — commons keeps nothing'

insert into public.posts (room_slug, post_no, author_id, body, created_at)
values ('commons', 99, '99999999-9999-4999-8999-999999999999', 'stale', now() - interval '25 hours');

begin;
  set local role anon;
  select tests.ok(
    (select count(*) from public.posts where room_slug = 'commons' and post_no = 99) = 0,
    'a 25-hour-old commons post is invisible'
  );
  select tests.ok(
    (select count(*) from public.posts where room_slug = 'commons') = 2,
    'the fresh commons posts are still there'
  );
  select tests.ok(
    (select count(*) from public.posts where room_slug = 'music') >= 2,
    'expiry does not touch rooms that keep things'
  );
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';
  select tests.raises(
    $sql$insert into public.replies (post_id, author_id, body)
         select id, '99999999-9999-4999-8999-999999999999', 'threading the hallway'
           from public.posts where room_slug = 'commons' limit 1$sql$,
    'commons refuses replies, so it cannot grow threads'
  );
commit;


\echo ''
\echo '§3.9 — reading is anonymous, writing is accountable'

begin;
  set local role anon;
  select tests.ok((select count(*) from public.rooms) = 5, 'anonymous readers see every room');
  select tests.ok((select count(*) from public.posts) > 0, 'anonymous readers see posts');
  select tests.ok((select count(*) from public.replies) > 0, 'anonymous readers see replies');
  select tests.ok((select count(*) from public.profiles) > 0, 'anonymous readers see who people are');

  select tests.raises(
    $sql$select public.create_post('music', 'anonymous words')$sql$,
    'an anonymous visitor cannot post'
  );
  select tests.raises(
    $sql$insert into public.replies (post_id, author_id, body)
         values ((select id from public.posts limit 1),
                 '99999999-9999-4999-8999-999999999999', 'anonymous reply')$sql$,
    'an anonymous visitor cannot reply'
  );
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';

  select tests.raises(
    $sql$insert into public.replies (post_id, author_id, body)
         values ((select id from public.posts where room_slug = 'music' limit 1),
                 '11111111-1111-4111-8111-111111111111', 'signed as someone else')$sql$,
    'you cannot write under another name'
  );

  select tests.raises(
    $sql$insert into public.posts (room_slug, post_no, author_id, body)
         values ('music', 500, '99999999-9999-4999-8999-999999999999', 'hand-numbered')$sql$,
    'nobody may choose their own post number'
  );

  select tests.changes_nothing(
    $sql$update public.posts set body = 'edited by a stranger'
          where author_id = '11111111-1111-4111-8111-111111111111'$sql$,
    'you cannot edit someone else''s post'
  );

  select tests.raises(
    $sql$update public.posts set author_id = '11111111-1111-4111-8111-111111111111'
          where author_id = auth.uid()$sql$,
    'you cannot hand your own post to someone else'
  );
commit;

select tests.ok(
  (select count(*) from public.posts where body = 'edited by a stranger') = 0,
  'the stranger''s post survived the attempt untouched'
);


\echo ''
\echo '§3.11 — the lobby shows proof of life'

begin;
  set local role anon;
  select tests.ok(
    (select count(*) from public.room_overview where latest_body is not null) = 5,
    'every seeded room has something recent to show'
  );
  select tests.ok(
    (select latest_author from public.room_overview where slug = 'music') is not null,
    'the lobby can say who said it'
  );
  -- The view must not become a way around the policies it reads from.
  select tests.ok(
    (select latest_body from public.room_overview where slug = 'commons') is distinct from 'stale',
    'an expired commons post never surfaces in the lobby'
  );
commit;


\echo ''
\echo '§4.3 — replies are flat, permanently'

select tests.ok(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'replies'
      and column_name in ('parent_id', 'reply_to', 'depth')) = 0,
  'replies carry no parent pointer, so threading cannot appear by accident'
);


\echo ''
\echo '§4.7 (revised) — one contribution, then check your email'

insert into auth.users (id, aud, role, email)
values ('88888888-8888-4888-8888-888888888888', 'authenticated', 'authenticated', 'newcomer@seed.invalid')
on conflict (id) do nothing;

-- Deliberately no verified_at: this is someone who just signed up.
insert into public.profiles (id, name)
values ('88888888-8888-4888-8888-888888888888', 'newcomer')
on conflict (id) do nothing;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '88888888-8888-4888-8888-888888888888';

  -- §3.9 is untouched: the held sentence goes through.
  select tests.ok(
    (public.create_post('music', 'the thing i was trying to say')).post_no is not null,
    'an unverified newcomer''s first post goes through'
  );

  select tests.raises(
    $sql$select public.create_post('music', 'and another thing')$sql$,
    'the second one asks them to check their email'
  );

  select tests.raises(
    $sql$insert into public.replies (post_id, author_id, body)
         values ((select id from public.posts where room_slug = 'music' limit 1),
                 '88888888-8888-4888-8888-888888888888', 'a reply instead')$sql$,
    'and so does replying — the free contribution is one, not one of each'
  );
commit;

-- They click the link.
update public.profiles set verified_at = now()
 where id = '88888888-8888-4888-8888-888888888888';

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '88888888-8888-4888-8888-888888888888';

  select tests.ok(
    (public.create_post('music', 'now that i am verified')).post_no is not null,
    'verifying lets them carry on'
  );

  select tests.ok(
    (select count(*) from public.replies where author_id = '88888888-8888-4888-8888-888888888888') = 0,
    'the refused reply was never written'
  );
commit;

select tests.ok(
  (select count(*) from public.posts
    where author_id = '88888888-8888-4888-8888-888888888888') = 2,
  'exactly the two posts that were allowed exist'
);

\echo ''
\echo 'all schema tests passed'
