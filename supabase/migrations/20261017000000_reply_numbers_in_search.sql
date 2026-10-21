-- Search results say which reply, not only which post.
--
-- QA: `go ~ryan` listed poker/10 twice — the post, and "poker/10 (reply)" —
-- and `find` did the same with kitchen/4. Both lines were right: one was the
-- post and one was a reply under it. But a reply only carried its post's
-- address, so the two read as a duplicate, and nothing on screen said which
-- reply to look for once you got there.
--
-- Replies have numbers inside their post (`reply 2 <something>` answers reply
-- 2), so this returns that number alongside the post's: null for a post, the
-- reply's number for a reply. Same arguments, same rows, same order — one
-- column more.
--
-- Dropped and recreated rather than `create or replace`, because Postgres will
-- not change what a function returns in place.

drop function if exists public.search_said (text, citext, citext, timestamptz, integer);

create function public.search_said (
  p_text  text default null,
  p_room  citext default null,
  p_by    citext default null,
  p_since timestamptz default null,
  p_limit integer default 20
)
returns table (
  room       citext,
  post_no    integer,
  author     citext,
  body       text,
  created_at timestamptz,
  is_reply   boolean,
  reply_no   integer
)
language sql
stable
security definer
set search_path = public
as $$
  with term as (
    select case
             when p_text is null or btrim(p_text) = '' then null
             else '%' || replace(replace(replace(btrim(p_text), '\', '\\'), '%', '\%'), '_', '\_') || '%'
           end as pattern
  ),
  said as (
    select p.room_slug as room, p.post_no, a.name as author, p.body, p.created_at,
           false as is_reply, null::integer as reply_no
      from public.posts p
      join public.rooms rm on rm.slug = p.room_slug
      join public.profiles a on a.id = p.author_id
     where p.hidden_at is null
       and rm.hidden_at is null
       and not rm.ephemeral

    union all

    select p.room_slug as room, p.post_no, a.name as author, r.body, r.created_at,
           true as is_reply, r.reply_no
      from public.replies r
      join public.posts p on p.id = r.post_id
      join public.rooms rm on rm.slug = p.room_slug
      join public.profiles a on a.id = r.author_id
     where r.hidden_at is null
       -- A reply under a hidden post is hidden with it: the address it would
       -- send you to shows nothing, so a hit there is a dead end.
       and p.hidden_at is null
       and rm.hidden_at is null
       and not rm.ephemeral
  )
  select said.room, said.post_no, said.author, said.body, said.created_at, said.is_reply, said.reply_no
    from said, term
   where (term.pattern is null or said.body ilike term.pattern escape '\')
     and (p_room  is null or said.room = p_room)
     and (p_by    is null or said.author = p_by)
     and (p_since is null or said.created_at >= p_since)
   order by said.created_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

-- The same callers as before: reading is anonymous (§3.9).
revoke all on function public.search_said (text, citext, citext, timestamptz, integer) from public;
grant execute on function public.search_said (text, citext, citext, timestamptz, integer) to anon, authenticated;
