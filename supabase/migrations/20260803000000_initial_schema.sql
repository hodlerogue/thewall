-- thewall.sh — initial schema
--
-- Two design claims from the decision document are enforced here rather than in
-- application code, because both are correctness properties and neither should
-- depend on every future query remembering a rule:
--
--   §3.4  post numbers are permanent and never positional
--   §3.10 commons keeps nothing

create extension if not exists citext;

-- Profiles ------------------------------------------------------------------
-- One row per account, keyed to the auth user. `name` is what appears in the
-- prompt and on every post, so it is unique and case-insensitive: `Marisol`
-- must not be able to sit next to `marisol`.
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       citext not null unique,
  created_at timestamptz not null default now(),
  constraint profiles_name_shape check (name ~ '^[a-z0-9_]{2,20}$')
);

-- Rooms ---------------------------------------------------------------------
create table public.rooms (
  slug       citext primary key,
  gloss      text not null,
  -- §3.10 — an ephemeral room is a hallway: posts expire, no permanent ids,
  -- no threads. Commons is the only one at launch.
  ephemeral  boolean not null default false,
  sort_order integer not null default 0,
  -- §3.4 — the allocator. Monotonic, never decremented, never reused, so a
  -- deleted post does not renumber anything after it.
  next_post_no integer not null default 1,
  created_at timestamptz not null default now(),
  constraint rooms_slug_shape check (slug ~ '^[a-z0-9-]{2,24}$')
);

-- Posts ---------------------------------------------------------------------
-- `id` is the internal surrogate. `post_no` is the address the user sees and
-- types (`go 12`) and the one that appears in the URL (`/music/12`) — the same
-- value in both places, which is what makes shareable URLs free (§3.4).
create table public.posts (
  id         bigint generated always as identity primary key,
  room_slug  citext not null references public.rooms (slug) on delete cascade,
  post_no    integer not null,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint posts_body_length check (char_length(body) between 1 and 2000),
  -- The address is unique within its room, and that is enforced by the
  -- database rather than trusted from the client.
  constraint posts_address unique (room_slug, post_no)
);

create index posts_room_recent on public.posts (room_slug, created_at desc);

-- Replies -------------------------------------------------------------------
-- §4.3 — replies are flat, permanently. There is deliberately no parent_id:
-- the constraint is stated in the schema so that "add threading later" cannot
-- happen by accident.
create table public.replies (
  id         bigint generated always as identity primary key,
  post_id    bigint not null references public.posts (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint replies_body_length check (char_length(body) between 1 and 2000)
);

create index replies_post_order on public.replies (post_id, created_at);

-- Ephemerality --------------------------------------------------------------

-- The single definition of "still here". Everything else refers to this, so
-- the 24-hour window is stated once (§3.10).
create or replace function public.is_visible (p_room citext, p_created_at timestamptz)
returns boolean
language sql
stable
as $$
  select not coalesce((select ephemeral from public.rooms where slug = p_room), false)
      or p_created_at > now() - interval '24 hours';
$$;

-- §3.10 — commons has no threads. Enforced at write time, since a reply to an
-- expiring post is a thread by another name.
create or replace function public.reject_reply_in_ephemeral_room ()
returns trigger
language plpgsql
as $$
declare
  v_ephemeral boolean;
begin
  select r.ephemeral into v_ephemeral
    from public.posts p
    join public.rooms r on r.slug = p.room_slug
   where p.id = new.post_id;

  if v_ephemeral then
    raise exception 'commons does not keep threads'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger replies_reject_ephemeral
  before insert on public.replies
  for each row execute function public.reject_reply_in_ephemeral_room ();

-- Post allocation -----------------------------------------------------------

-- §3.4 — the client never picks a number. The counter is bumped and the row is
-- inserted in one statement inside one transaction, so two people posting at
-- the same instant cannot land on the same address, and nothing is ever reused.
create or replace function public.create_post (p_room citext, p_body text)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_no integer;
  v_post    public.posts;
begin
  if auth.uid () is null then
    raise exception 'you have to be signed in to say something'
      using errcode = 'insufficient_privilege';
  end if;

  -- The UPDATE takes a row lock on the room, which serialises concurrent
  -- allocation without a separate sequence per room.
  update public.rooms
     set next_post_no = next_post_no + 1
   where slug = p_room
  returning next_post_no - 1 into v_post_no;

  if v_post_no is null then
    raise exception 'no room called %', p_room using errcode = 'no_data_found';
  end if;

  insert into public.posts (room_slug, post_no, author_id, body)
  values (p_room, v_post_no, auth.uid (), p_body)
  returning * into v_post;

  return v_post;
end;
$$;

revoke all on function public.create_post (citext, text) from public;
grant execute on function public.create_post (citext, text) to authenticated;

-- Row level security --------------------------------------------------------
-- §3.9 — reading is anonymous. Every select policy is open; only writing needs
-- an account, and the first `say` is what asks for one.

alter table public.profiles enable row level security;
alter table public.rooms    enable row level security;
alter table public.posts    enable row level security;
alter table public.replies  enable row level security;

create policy "anyone may read profiles"
  on public.profiles for select using (true);

create policy "you may create your own profile"
  on public.profiles for insert with check (id = auth.uid ());

create policy "you may edit your own profile"
  on public.profiles for update using (id = auth.uid ()) with check (id = auth.uid ());

create policy "anyone may read rooms"
  on public.rooms for select using (true);

-- §3.10 — the expiry is a read policy, not a filter every query has to
-- remember. Commons is structurally incapable of keeping anything.
create policy "anyone may read posts that are still here"
  on public.posts for select using (public.is_visible (room_slug, created_at));

-- Posting goes through create_post, which owns the numbering. Direct inserts
-- would have to pick a post_no, so they are simply not allowed.
create policy "you may edit your own posts"
  on public.posts for update using (author_id = auth.uid ()) with check (author_id = auth.uid ());

create policy "anyone may read replies to posts that are still here"
  on public.replies for select using (
    exists (
      select 1 from public.posts p
       where p.id = replies.post_id
         and public.is_visible (p.room_slug, p.created_at)
    )
  );

create policy "you may reply as yourself"
  on public.replies for insert with check (author_id = auth.uid ());

-- The lobby ------------------------------------------------------------------
-- §3.11 — `look` at the lobby shows each room with its most recent activity:
-- last post, how long ago, who said it. It costs nothing and it is the
-- difference between a busy building and a list of doors.
--
-- security_invoker makes the view run with the caller's rights, so the reader's
-- RLS applies to the rows underneath it. Without it a view silently becomes a
-- hole in the policies it sits on top of.
create view public.room_overview
with (security_invoker = true) as
select
  r.slug,
  r.gloss,
  r.ephemeral,
  r.sort_order,
  latest.body       as latest_body,
  latest.created_at as latest_at,
  author.name       as latest_author
from public.rooms r
left join lateral (
  select p.body, p.created_at, p.author_id
    from public.posts p
   where p.room_slug = r.slug
     -- Stated again rather than left to RLS alone: a service-role reader
     -- bypasses policies, and commons must look empty to everyone (§3.10).
     and public.is_visible (p.room_slug, p.created_at)
   order by p.created_at desc
   limit 1
) latest on true
left join public.profiles author on author.id = latest.author_id;

-- Grants --------------------------------------------------------------------
-- Stated explicitly rather than leaning on the hosted project's default
-- privileges, so the migration means the same thing wherever it is applied.
-- RLS decides which rows; these decide which verbs.

grant select on public.rooms, public.posts, public.replies, public.profiles,
  public.room_overview to anon, authenticated;

-- No direct insert on posts: numbering belongs to create_post (§3.4), and a
-- client that could insert would have to choose a post_no itself.
grant insert on public.replies, public.profiles to authenticated;
grant update on public.posts, public.profiles to authenticated;

-- Realtime ------------------------------------------------------------------
alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.replies;
