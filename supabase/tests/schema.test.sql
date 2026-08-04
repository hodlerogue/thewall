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

  select tests.raises(
    $sql$update public.posts set body = 'edited by a stranger'
          where author_id = '11111111-1111-4111-8111-111111111111'$sql$,
    'you cannot edit someone else''s post'
  );
commit;

select tests.ok(
  (select count(*) from public.posts where body = 'edited by a stranger') = 0,
  'the stranger''s post survived the attempt untouched'
);


\echo ''
\echo 'columns, not just rows — what the grants used to allow'

-- These are the assertions whose absence let two invariants be bypassed from
-- the browser console. Every one targets the user's OWN row: ownership was
-- never the hole, column scope was.

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';

  select tests.raises(
    $sql$update public.profiles set verified_at = now() where id = auth.uid()$sql$,
    'you cannot verify yourself — the §4.7 gate is not yours to open'
  );

  select tests.raises(
    $sql$update public.profiles set name = 'someone_else' where id = auth.uid()$sql$,
    'you cannot rename yourself at will (§4.6 will add exactly one)'
  );

  select tests.raises(
    $sql$update public.posts set created_at = now() + interval '1 year'
          where author_id = auth.uid()$sql$,
    'you cannot future-date your own post to outlive commons (§3.10)'
  );

  select tests.raises(
    $sql$update public.posts set body = 'quietly rewritten' where author_id = auth.uid()$sql$,
    'you cannot silently rewrite your own post after it was replied to'
  );

  select tests.raises(
    $sql$update public.posts set room_slug = 'poker' where author_id = auth.uid()$sql$,
    'you cannot move your own post to another room'
  );

  select tests.raises(
    $sql$update public.posts set post_no = 999 where author_id = auth.uid()$sql$,
    'you cannot squat an address the allocator has not reached (§3.4)'
  );
commit;

select tests.ok(
  (select count(*) from public.posts
    where created_at > now() + interval '1 hour') = 0,
  'no post anywhere is dated into the future'
);


\echo ''
\echo 'bodies have to be something'

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';

  select tests.raises(
    $sql$select public.create_post('music', '    ')$sql$,
    'a whitespace-only post is refused rather than eating an address'
  );

  select tests.raises(
    $sql$select public.create_post('music', repeat(E'\n', 200))$sql$,
    'a newline flood is refused — the one griefing primitive this design has'
  );

  select tests.ok(
    (public.create_post('music', E'two\nlines is fine')).post_no is not null,
    'ordinary line breaks still work'
  );
commit;


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
\echo '§4.1 — mail is replies to you, that you have not read'

-- jameson wrote music/12. tester replies to it; jameson should have mail.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';
  insert into public.replies (post_id, author_id, body)
  select id, auth.uid(), 'a reply that should show up as mail'
    from public.posts where room_slug = 'music' and post_no = 12;
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

  select tests.ok(public.mail_count() >= 1, 'a reply to your post is mail');

  select tests.ok(
    (select count(*) from public.mail() where body = 'a reply that should show up as mail') = 1,
    'and it comes back with the words'
  );

  select tests.ok(
    (select room || '/' || post_no from public.mail()
      where body = 'a reply that should show up as mail') = 'music/12',
    'carrying the address to walk to — a notification you cannot reach is an alert'
  );
commit;

-- Reading is the only signal there is, since §4.1 is pull-only.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
  select public.mark_mail_seen();
  select tests.ok(public.mail_count() = 0, 'reading it clears the count');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';
  -- The replier is not the recipient.
  select tests.ok(
    (select count(*) from public.mail() where body = 'a reply that should show up as mail') = 0,
    'your own reply is not mail for you'
  );
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
  select tests.ok(
    (select count(*) from public.mail() where body = 'a reply that should show up as mail') = 0,
    'and it is nobody else''s mail either'
  );
commit;

begin;
  set local role anon;
  select tests.raises(
    $sql$select public.mail_count()$sql$,
    'a guest has no mail to read'
  );
commit;

\echo ''
\echo 'all schema tests passed'
