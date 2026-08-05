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
  select tests.ok(
    (select count(*) from public.rooms where owner_id is null) = 6,
    'anonymous readers see every room');
  -- Including the ones that are somebody's wall: a wall is not private, it is
  -- just not in the lobby.
  select tests.ok(
    (select count(*) from public.rooms where owner_id is not null) > 0,
    'and every wall, which is public like everything else here');
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
    (select count(*) from public.room_overview where latest_body is not null) = 6,
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
\echo '§6 — the manual kill switch, and nothing destroyed by using it'

-- Somebody to remove, with a post that other people have replied to. That is
-- the case the whole design of this turns on: the wrong lever takes their
-- neighbours' words with it.
insert into auth.users (id, aud, role, email)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'authenticated', 'authenticated', 'nuisance@seed.invalid')
on conflict (id) do nothing;
insert into public.profiles (id, name, verified_at)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'nuisance', now())
on conflict (id) do nothing;

insert into public.posts (room_slug, post_no, author_id, body)
values ('poker', 900, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'something worth removing');

insert into public.replies (post_id, author_id, body)
select id, '99999999-9999-4999-8999-999999999999', 'a bystander answering'
  from public.posts where room_slug = 'poker' and post_no = 900;

select tests.ok(public.hide_post('poker', 900) = 1, 'hide_post hides exactly one post');

begin;
  set local role anon;
  select tests.ok(
    (select count(*) from public.posts where room_slug = 'poker' and post_no = 900) = 0,
    'a hidden post is gone for readers'
  );
  select tests.ok(
    (select count(*) from public.replies where body = 'a bystander answering') = 0,
    'and so is the conversation under it'
  );
commit;

-- The point of a soft delete: the bystander's words are still there.
select tests.ok(
  (select count(*) from public.replies where body = 'a bystander answering') = 1,
  'but nothing was destroyed — the reply is still in the table'
);

-- A hidden post cannot be found, so an insert that looks it up matches nothing
-- and is refused only in the sense that it wrote nothing. The claim worth
-- testing is the other one: somebody who kept the internal id is stopped by the
-- policy itself, not by being unable to see it.
create table if not exists tests.ids (k text primary key, v bigint);
grant select on tests.ids to anon, authenticated;
insert into tests.ids (k, v)
select 'hidden_post', id from public.posts where room_slug = 'poker' and post_no = 900
on conflict (k) do update set v = excluded.v;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';
  select tests.raises(
    $sql$insert into public.replies (post_id, author_id, body)
         values ((select v from tests.ids where k = 'hidden_post'),
                 '99999999-9999-4999-8999-999999999999', 'still talking')$sql$,
    'a hidden post cannot be replied to, even by someone who kept its id'
  );
commit;

select tests.ok(public.hide_post('poker', 900, false) = 1, 'unhiding puts it back');

begin;
  set local role anon;
  select tests.ok(
    (select count(*) from public.posts where room_slug = 'poker' and post_no = 900) = 1,
    'the post returns'
  );
  select tests.ok(
    (select count(*) from public.replies where body = 'a bystander answering') = 1,
    'with the conversation it had'
  );
commit;

-- §3.4 — hiding is not deleting, and neither one moves an address.
select public.hide_post('poker', 900);
select tests.ok(
  (select count(*) from public.posts where room_slug = 'poker' and post_no = 900) = 1,
  'a hidden post keeps its row, so nothing after it renumbers'
);
select tests.raises(
  $sql$insert into public.posts (room_slug, post_no, author_id, body)
       values ('poker', 900, '99999999-9999-4999-8999-999999999999', 'taking the empty seat')$sql$,
  'and it keeps its address, which cannot be reissued while it is hidden'
);
select public.hide_post('poker', 900, false);

\echo ''
\echo '§6 — banning somebody keeps their name and their neighbours'

select tests.ok(
  public.ban('nuisance', 'flooding poker') = 1,
  'ban hides what they said, and says how much'
);

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  select tests.raises(
    $sql$select public.create_post('poker', 'back again')$sql$,
    'a banned account cannot post'
  );
  select tests.raises(
    $sql$insert into public.replies (post_id, author_id, body)
         select id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'back again'
           from public.posts where room_slug = 'music' and post_no = 12$sql$,
    'or reply'
  );
commit;

select tests.ok(
  (select count(*) from public.profiles where name = 'nuisance') = 1,
  'the account is still there — the name stays reserved and dead (§4.6)'
);

-- The reply was written by the bystander, not by the banned account, so it must
-- survive the ban. Deleting the account would have cascaded it away.
select tests.ok(
  (select count(*) from public.replies where body = 'a bystander answering') = 1,
  'and nobody else lost what they wrote'
);

select tests.ok(public.unban('nuisance') = 1, 'unban restores what ban hid');

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select tests.ok(
    (public.create_post('poker', 'trying again politely')).post_no is not null,
    'and lets them speak again'
  );
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';
  select tests.raises($sql$select public.ban('nuisance')$sql$, 'the levers are not reachable by a signed-in user');
commit;

begin;
  set local role anon;
  select tests.raises($sql$select public.hide_room('poker')$sql$, 'nor by anyone reading');
commit;

\echo ''
\echo '§6 — hiding a whole room'

select tests.ok(public.hide_room('latenight') = 1, 'hide_room hides it');

begin;
  set local role anon;
  select tests.ok(
    (select count(*) from public.rooms where slug = 'latenight') = 0,
    'a hidden room does not exist for readers'
  );
  select tests.ok(
    (select count(*) from public.posts where room_slug = 'latenight') = 0,
    'and neither does anything inside it'
  );
  select tests.ok(
    (select count(*) from public.room_overview where slug = 'latenight') = 0,
    'and it is not in the lobby'
  );
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';
  -- create_post is security definer, so the read policy does not protect it.
  -- Anyone who remembered the name could otherwise keep posting into it.
  select tests.raises(
    $sql$select public.create_post('latenight', 'anyone still awake')$sql$,
    'and nobody who remembers the name can post into it'
  );
commit;

select public.hide_room('latenight', false);

\echo ''
\echo '§4.2 — decay rules, written and not enabled'

select tests.ok(
  public.archive_quiet_rooms(interval '1 second') > 0,
  'a room nobody has posted in goes quiet'
);

begin;
  set local role anon;
  select tests.ok(
    (select count(*) from public.room_overview where slug = 'latenight') = 0,
    'an archived room drops out of the lobby'
  );
  select tests.ok(
    (select count(*) from public.rooms where slug = 'latenight') = 1,
    'but is still reachable by name — archived, not deleted'
  );
  select tests.ok(
    (select count(*) from public.posts where room_slug = 'latenight') > 0,
    'and everything in it is still readable'
  );
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';
  select public.create_post('latenight', 'still awake, as it happens');
commit;

begin;
  set local role anon;
  select tests.ok(
    (select count(*) from public.room_overview where slug = 'latenight') = 1,
    'and saying something in it brings it back'
  );
commit;

-- Commons is empty by design every morning (§3.10); archiving the front door
-- would be a bug, not decay.
select tests.ok(
  (select archived_at from public.rooms where slug = 'commons') is null,
  'commons is never archived for being quiet'
);

\echo ''
\echo 'a rate limit on saying things, which there was none of'

insert into auth.users (id, aud, role, email)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'authenticated', 'authenticated', 'flood@seed.invalid')
on conflict (id) do nothing;
insert into public.profiles (id, name, verified_at)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'flood', now())
on conflict (id) do nothing;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  -- Nineteen posts and one reply: twenty contributions, which is the whole
  -- allowance, and it has to be one allowance rather than two.
  select public.create_post('poker', 'flooding ' || g) from generate_series(1, 19) g;

  insert into public.replies (post_id, author_id, body)
  select id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'and a reply'
    from public.posts where room_slug = 'music' and post_no = 12;

  select tests.raises(
    $sql$select public.create_post('poker', 'and one more')$sql$,
    'the twenty-first contribution in five minutes is refused'
  );
  select tests.raises(
    $sql$insert into public.replies (post_id, author_id, body)
         select id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'or a reply'
           from public.posts where room_slug = 'music' and post_no = 12$sql$,
    'and replying does not have its own separate allowance'
  );
commit;

-- The window is what makes it a rate limit rather than a quota.
update public.posts   set created_at = created_at - interval '10 minutes' where author_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.replies set created_at = created_at - interval '10 minutes' where author_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  select tests.ok(
    (public.create_post('poker', 'later, calmly')).post_no is not null,
    'and once the window passes they can speak again'
  );
commit;

\echo ''
\echo '§4.7 — the gate holds inside a single statement, not just between them'

insert into auth.users (id, aud, role, email)
values ('66666666-6666-4666-8666-666666666666', 'authenticated', 'authenticated', 'batch@seed.invalid')
on conflict (id) do nothing;
insert into public.profiles (id, name)
values ('66666666-6666-4666-8666-666666666666', 'batch')
on conflict (id) do nothing;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666666';

  -- may_contribute was STABLE, so every call in one statement read the snapshot
  -- taken before it began and each of them saw an account that had written
  -- nothing. One free contribution became as many as fitted in a select.
  select tests.raises(
    $sql$select public.create_post('poker', 'batched ' || g) from generate_series(1, 3) g$sql$,
    'three posts in one statement cannot all be the free one'
  );
commit;

select tests.ok(
  (select count(*) from public.posts where author_id = '66666666-6666-4666-8666-666666666666') = 0,
  'and the statement that tried it wrote nothing at all'
);

\echo ''
\echo '§4.6 revised — rename as often as you like, and the old name goes free'

insert into auth.users (id, aud, role, email)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'authenticated', 'authenticated', 'renamer@seed.invalid')
on conflict (id) do nothing;
insert into public.profiles (id, name, verified_at)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'firstname', now())
on conflict (id) do nothing;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  select tests.ok(public.change_name('secondname') = 'secondname', 'change_name changes it');

  -- Unlimited is the whole revision: the second one has to work as easily.
  select tests.ok(public.change_name('thirdname') = 'thirdname', 'and again, with no cap');

  select tests.raises(
    $sql$select public.change_name('tester')$sql$,
    'a name somebody is using is refused'
  );

  select tests.raises(
    $sql$select public.change_name('thirdname')$sql$,
    'and so is the one you already have'
  );
commit;

-- Attribution follows the person, not the post. This is the consequence the
-- prompt states out loud when you rename, and it is why it is worth asserting.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  select public.create_post('kitchen', 'said under the third name');
commit;

select tests.ok(
  (select a.name from public.posts p join public.profiles a on a.id = p.author_id
    where p.body = 'said under the third name') = 'thirdname',
  'everything they said carries the name they have now'
);

-- Nobody may change a name any other way: there is no UPDATE grant on profiles,
-- which is what makes the history record impossible to route around.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  select tests.raises(
    $sql$update public.profiles set name = 'sneaky' where id = auth.uid()$sql$,
    'and the only door to a rename is the one that records it'
  );
commit;

\echo ''
\echo 'a released name is free, and whoever takes it is disclosed'

select tests.ok(
  public.name_changed_hands('firstname') is null,
  'a released name nobody has taken yet warns about nothing'
);

-- Somebody else picks it up. This is the case the doc's "old name stays
-- reserved and dead" was written to prevent, now allowed on purpose.
insert into auth.users (id, aud, role, email)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'authenticated', 'authenticated', 'taker@seed.invalid')
on conflict (id) do nothing;
insert into public.profiles (id, name, verified_at)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'firstname', now())
on conflict (id) do nothing;

select tests.ok(
  public.name_changed_hands('firstname') is not null,
  'once somebody else takes it, the profile says the name changed hands'
);

-- The disclosure is a date and never a person. Publishing whose it was would
-- make renaming useless to the one person §4.6 exists for.
begin;
  set local role anon;
  select tests.raises(
    $sql$select count(*) from public.name_history$sql$,
    'and nobody can read who held it before'
  );
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  select tests.raises(
    $sql$select count(*) from public.name_history$sql$,
    'not even signed in'
  );
commit;

select tests.ok(
  public.name_changed_hands('thirdname') is null,
  'and renaming away from a name you still hold is not a change of hands'
);

\echo ''
\echo 'renaming is gated by the same things saying anything is'

begin;
  set local role anon;
  select tests.raises($sql$select public.change_name('anonymous')$sql$, 'a guest cannot rename');
commit;

select public.ban('thirdname', 'testing');
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  select tests.raises(
    $sql$select public.change_name('escaping')$sql$,
    'and a banned account cannot rename its way out of it'
  );
commit;
select public.unban('thirdname');

\echo ''
\echo 'erasure — the address goes, the conversation around it does not'

insert into public.replies (post_id, author_id, body)
select id, '99999999-9999-4999-8999-999999999999', 'somebody else answering the leaver'
  from public.posts where body = 'said under the third name';

select tests.ok(
  public.forget('thirdname') like 'deleted_%',
  'forget returns the handle that is now nobody'
);

select tests.ok(
  (select count(*) from public.profiles where name = 'thirdname') = 0,
  'the name they used is gone'
);

select tests.ok(
  (select count(*) from public.name_history
    where profile_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd') = 0,
  'and so is every name they ever held'
);

select tests.ok(
  public.name_changed_hands('firstname') is null,
  'so nothing can point back at them through a name they released'
);

select tests.ok(
  (select email from auth.users where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
    like '%@deleted.invalid',
  'the address is overwritten, not left behind'
);

-- The reason this is anonymisation rather than a delete: the cascade would
-- have taken this with it, and it was written by somebody who did not leave.
select tests.ok(
  (select count(*) from public.replies where body = 'somebody else answering the leaver') = 1,
  'the reply somebody else wrote is still there'
);

select tests.ok(
  (select count(*) from public.posts where body = 'said under the third name') = 1,
  'and so is the post it hangs off — taking it down is a separate request'
);

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  select tests.raises(
    $sql$select public.create_post('kitchen', 'back from the dead')$sql$,
    'a closed account cannot post'
  );
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';
  select tests.raises($sql$select public.forget('tester')$sql$, 'erasure is not a lever users hold');
commit;

\echo ''
\echo 'walls — §3.10 reversed, and the geography kept anyway'

insert into auth.users (id, aud, role, email)
values ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'authenticated', 'authenticated', 'waller@seed.invalid')
on conflict (id) do nothing;
insert into public.profiles (id, name, verified_at)
values ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'waller', now())
on conflict (id) do nothing;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  -- Made on first use, not at signup: everybody starting with an empty room
  -- they never asked for is the §5 failure mode, once per account.
  select tests.ok(
    (public.create_post('~waller', 'the first thing on my wall')).post_no = 1,
    'a wall is created by putting something on it'
  );
  select tests.ok(
    (public.create_post('~waller', 'and a second')).post_no = 2,
    'and it allocates addresses like any other room (§3.4)'
  );
commit;

select tests.ok(
  (select owner_id from public.rooms where slug = '~waller')
    = 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  'the wall belongs to them'
);

-- §4.2 — forty rooms with three people each kills the feeling, and a room per
-- person is exactly that. A wall is reached through its owner, never browsed.
begin;
  set local role anon;
  select tests.ok(
    (select count(*) from public.room_overview where slug = '~waller') = 0,
    'and it is not in the lobby'
  );
  select tests.ok(
    (select count(*) from public.posts where room_slug = '~waller') = 2,
    'but everything on it is public, like everything else here'
  );
commit;

\echo ''
\echo 'a wall is yours to start things on, and everyone else’s to answer'

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';

  select tests.raises(
    $sql$select public.create_post('~waller', 'posting on your wall as if it were mine')$sql$,
    'somebody else cannot post to your wall'
  );

  -- The whole point of it being a wall rather than a diary.
  insert into public.replies (post_id, author_id, body)
  select id, '99999999-9999-4999-8999-999999999999', 'answering on somebody''s wall'
    from public.posts where room_slug = '~waller' and post_no = 1;
commit;

select tests.ok(
  (select count(*) from public.replies where body = 'answering on somebody''s wall') = 1,
  'but anybody may reply to what is on it'
);

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';
  select tests.raises(
    $sql$select public.create_post('~nobodyatall', 'a wall for somebody who is not me')$sql$,
    'and nobody can make a wall in another name'
  );
commit;

\echo ''
\echo 'a wall follows its owner’s name (§4.6)'

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  select public.change_name('walled');
commit;

select tests.ok(
  (select count(*) from public.rooms where slug = '~walled') = 1,
  'renaming moves the wall to the new address'
);
select tests.ok(
  (select count(*) from public.posts where room_slug = '~walled') = 2,
  'and every post on it comes along — the address is a name, and names move'
);
select tests.ok(
  (select count(*) from public.rooms where slug = '~waller') = 0,
  'nothing is left at the old one'
);

-- One each, and it has to look like what it is.
select tests.raises(
  $sql$insert into public.rooms (slug, gloss, ephemeral, owner_id)
       values ('~walled2', 'a second wall', false, 'ffffffff-ffff-4fff-8fff-ffffffffffff')$sql$,
  'nobody gets two walls'
);
select tests.raises(
  $sql$insert into public.rooms (slug, gloss, ephemeral, owner_id)
       values ('sneaky', 'a wall pretending to be a room', false, '99999999-9999-4999-8999-999999999999')$sql$,
  'a wall cannot be disguised as a room'
);
select tests.raises(
  $sql$insert into public.rooms (slug, gloss, ephemeral) values ('~orphan', 'a wall with no owner', false)$sql$,
  'and a room cannot be disguised as a wall'
);

-- §4.2 — room creation is closed, and closed means from the browser.
--
-- Every assertion above runs as the owner and tests a *constraint*. That is a
-- different question from what somebody with the anon key and a signed-in
-- session can do, and answering the first as though it settled the second is
-- exactly how the verified_at bypass shipped: a row policy says whose row it
-- is and nothing about which verbs anyone holds.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';

  select tests.raises(
    $sql$insert into public.rooms (slug, gloss, ephemeral, sort_order)
         values ('mine', 'a room i made from the console', false, 99)$sql$,
    'a signed-in user cannot open a room'
  );
  -- `raises`, not `changes_nothing`. An UPDATE the policy filters matches no
  -- rows and succeeds quietly; these are refused outright, because there is no
  -- UPDATE grant on rooms for anybody. That is the stronger of the two answers
  -- and worth asserting as the stronger one — if a grant is ever added, this
  -- fails rather than passing on a policy that might have holes in it.
  select tests.raises(
    $sql$update public.rooms set gloss = 'mine now' where slug = 'music'$sql$,
    'nor rewrite what a room is for'
  );
  select tests.raises(
    $sql$update public.rooms set owner_id = '99999999-9999-4999-8999-999999999999'
          where slug = 'music'$sql$,
    'nor claim one as a wall, which would take it out of the lobby'
  );
  select tests.raises(
    $sql$delete from public.rooms where slug = 'music'$sql$,
    'nor close one'
  );

  -- The one path that does create a room from a user action, held to its shape:
  -- it is reachable only through create_post, only for a `~` slug, and only for
  -- your own name. Every other spelling is "no room called that".
  select tests.raises(
    $sql$select public.create_post('brandnew', 'a room by writing to it')$sql$,
    'and posting to a name that is not a room does not conjure one'
  );
commit;

select tests.ok(
  (select count(*) from public.rooms where slug in ('mine', 'brandnew')) = 0,
  'none of that left a room behind'
);
select tests.ok(
  (select gloss from public.rooms where slug = 'music') = 'what you are listening to',
  'and music is still what it was'
);

-- Decay is about rooms going cold. A quiet wall is a person who has not posted
-- lately, which is not a problem and not anybody's to tidy up.
select public.archive_quiet_rooms(interval '1 second');
select tests.ok(
  (select archived_at from public.rooms where slug = '~walled') is null,
  'a quiet wall is never archived'
);

-- Every lever in §7 still reaches it, because a wall is a room.
select tests.ok(public.hide_post('~walled', 1) = 1, 'the kill switch reaches a wall');
begin;
  set local role anon;
  select tests.ok(
    (select count(*) from public.posts where room_slug = '~walled' and post_no = 1) = 0,
    'and hiding works there exactly as it does anywhere'
  );
commit;
select public.hide_post('~walled', 1, false);

\echo ''
\echo 'all schema tests passed'
