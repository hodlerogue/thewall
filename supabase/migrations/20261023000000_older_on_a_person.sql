-- `older` on somebody's page, and `find --limit` meaning what it says.
--
-- A person's page showed the newest ten things they had said and nothing could
-- reach the eleventh, while the feed's footer sent people there for exactly
-- that. `search_said` learns to start from a point in time, which is all paging
-- through one person needs: their items have no shared numbering, because they
-- are scattered across rooms, but they do have an order.
--
-- `find --limit` has always promised 1 to 100 and this stopped at 50.
--
-- Safe in either order with the deploy. Without this migration the app's
-- ordinary searches still resolve, because it sends `p_before` only when paging,
-- and paging says it is not switched on yet. With it, a call naming the old five
-- arguments still resolves, because the new one has a default.

-- Dropped rather than left beside the new one: two overloads that both accept
-- five named arguments are ambiguous, and PostgREST refuses those outright.
drop function if exists public.search_said (text, citext, citext, timestamptz, integer);

create function public.search_said (
  p_text  text default null,
  p_room  citext default null,
  p_by    citext default null,
  p_since timestamptz default null,
  p_limit integer default 20,
  -- Only what was said before this. Sent only when paging, so nothing else
  -- depends on this migration having landed.
  p_before timestamptz default null
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
     and (p_before is null or said.created_at < p_before)
   order by said.created_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

revoke all on function public.search_said (text, citext, citext, timestamptz, integer, timestamptz) from public;
grant execute on function public.search_said (text, citext, citext, timestamptz, integer, timestamptz) to anon, authenticated;
