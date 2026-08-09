-- Answering a reply, without a tree.
--
-- Asked for directly: "I want to be able to reply to replies." Until now a post
-- had a flat list of answers and there was no way to point at one of them, so a
-- thread with six replies in it was six people talking past each other.
--
-- §4.3 decided replies get no address of their own, and this changes that half
-- on purpose — you cannot answer a thing you cannot name. What it does *not*
-- change is the other half of that decision, which was really about nesting:
--
--   * A reply is numbered **within its post**, not globally. `music/12` has
--     replies 1, 2, 3, and the address of the conversation is still `music/12`.
--     Nothing gains a segment, nothing new appears in a URL, and `go` learns no
--     new shape.
--   * `to_reply_no` is a *pointer*, not a parent in a tree. The list stays flat
--     and in time order, and an answer to an answer says which one it is
--     answering. Same choice as rooms that grew out of a room, for the same
--     reason: a tree on a 380px screen is unreadable by the fourth level, and
--     the thing people actually want is to know what somebody is responding to.
--
-- So a thread reads:
--
--   1  marisol, 2h ago
--      warped ones still play, they just wobble
--   2  tuck, 1h ago  → 1
--      that is what makes them worth keeping
--
-- rather than drifting right until the words are two characters wide.

-- The address, and the pointer ------------------------------------------------
alter table public.replies
  add column if not exists reply_no    integer,
  add column if not exists to_reply_no integer;

comment on column public.replies.reply_no is
  'The reply''s number within its post. Permanent and never reused, like a '
  'post''s number within its room (§3.4).';
comment on column public.replies.to_reply_no is
  'Which reply this answers, if it answers one rather than the post. A label '
  'for reading, never a parent in a tree — the listing stays flat.';

-- Backfill, in the order they were written, which is the order they have always
-- been read in.
with numbered as (
  select id, row_number() over (partition by post_id order by created_at, id) as n
    from public.replies
)
update public.replies r
   set reply_no = numbered.n
  from numbered
 where numbered.id = r.id
   and r.reply_no is null;

alter table public.replies alter column reply_no set not null;

-- Never reused, exactly like a post's number in a room.
create unique index if not exists replies_address on public.replies (post_id, reply_no);

-- The allocator ---------------------------------------------------------------
--
-- On `posts`, mirroring `rooms.next_post_no`. Kept on the row rather than
-- derived from `max(reply_no) + 1`, for the reason §3.4 already gives: a hidden
-- reply leaves a gap, and `max` cannot see it, so deriving would hand the next
-- person an address somebody else already had.
alter table public.posts
  add column if not exists next_reply_no integer not null default 1;

update public.posts p
   set next_reply_no = coalesce(
     (select max(r.reply_no) + 1 from public.replies r where r.post_id = p.id),
     1
   );

-- Allocating one --------------------------------------------------------------
--
-- A trigger on the table rather than a line inside `create_reply`, and that is
-- the second attempt. The first put the allocation in the function, which meant
-- every *other* writer — `seed.sql`, and fifteen inserts in the schema tests —
-- had to compute a number itself or fall foul of the not-null. Fifteen places
-- that each have to remember an invariant is fifteen places that can forget it.
--
-- Here, an address is a property of the table: anything that inserts a reply
-- gets a correct one, in insert order, without knowing that reply numbers
-- exist. An explicit `reply_no` is still honoured, which is what lets a data
-- move carry the original addresses across.
create or replace function public.allocate_reply_no ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reply_no is null then
    -- Read and bump in one statement, so two people answering at the same
    -- moment cannot be handed the same number (§3.4).
    update public.posts
       set next_reply_no = next_reply_no + 1
     where id = new.post_id
    returning next_reply_no - 1 into new.reply_no;
  end if;
  return new;
end;
$$;

drop trigger if exists replies_allocate_no on public.replies;
create trigger replies_allocate_no
  before insert on public.replies
  for each row execute function public.allocate_reply_no ();

-- Writing one ------------------------------------------------------------------
--
-- Replies used to be inserted straight from the browser under a policy. That
-- cannot allocate a number: two people answering at the same moment would read
-- the same `next_reply_no` and write the same address. So this moves behind a
-- `security definer` function, exactly as posts did, and the insert grant goes.
--
-- Everything the policy checked is checked here and in the same order, so no
-- refusal changes wording: signed in, allowed to contribute (§4.7), and the post
-- readable — which is what stops a reply landing on a hidden post or in a
-- closed room.
create or replace function public.create_reply (
  p_room     citext,
  p_post_no  integer,
  p_body     text,
  -- Which reply is being answered. Null means the post itself, which is what
  -- `reply` with no number has always meant.
  p_to_reply integer default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id      uuid := auth.uid ();
  v_post_id bigint;
  v_no      integer;
begin
  if v_id is null then
    raise exception 'you have to be signed in to say something.'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.may_contribute (v_id) then
    raise exception 'check your email to keep saying things.'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_post_id
    from public.posts
   where room_slug = p_room and post_no = p_post_no;

  if v_post_id is null or not public.post_is_readable (v_post_id) then
    raise exception 'that post is not here.' using errcode = 'no_data_found';
  end if;

  /*
   * A pointer at something that is not there is worse than no pointer: it
   * renders as `→ 4` next to a thread that has three replies. Dropped rather
   * than refused, on the same reasoning as a room's `from_room` — losing
   * somebody's sentence over a label they mistyped is the worse trade.
   */
  if p_to_reply is not null
     and not exists (
       select 1 from public.replies
        where post_id = v_post_id and reply_no = p_to_reply and hidden_at is null
     ) then
    p_to_reply := null;
  end if;

  -- The number comes from the trigger above, so this does not repeat it — the
  -- one place that knows how an address is allocated is the table.
  insert into public.replies (post_id, author_id, body, to_reply_no)
  values (v_post_id, v_id, p_body, p_to_reply)
  returning reply_no into v_no;

  return v_no;
end;
$$;

revoke all on function public.create_reply (citext, integer, text, integer)
  from public, anon;
grant execute on function public.create_reply (citext, integer, text, integer)
  to authenticated;

-- The browser no longer writes this table directly. The policy stays: it is
-- what `post_is_readable` is enforced by for anything that still can.
revoke insert on public.replies from authenticated;

-- Reading the two new columns.
--
-- `grant select on public.replies` is table-wide and always has been, so these
-- are already readable and this line changes nothing. It is here to be explicit
-- about the decision rather than to make it: both are on the screen — a reply's
-- number and which reply it answers are exactly what the thread prints — so
-- publishing them is what is wanted. The rule is the one `profiles` has: a
-- column on a table with a table-wide select grant is public the moment it
-- exists, so ask whether you would publish it before adding it.
grant select (reply_no, to_reply_no) on public.replies to anon, authenticated;
