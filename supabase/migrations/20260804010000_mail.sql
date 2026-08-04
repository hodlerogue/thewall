-- §4.1 — notifications. The document's own highest-priority unsolved item:
--
--   "Nothing currently tells you someone replied. No notification means no
--    reason to return, which makes this the difference between a place people
--    try and a place people check."
--
-- Its lean is specific, so this is implementation rather than design:
--
--   "status bar shows the count persistently; `mail` lists them with `go <id>`
--    to jump. Pull-only, no push, no email. That's on-brand and it's less to
--    build."
--
-- One column and two functions. Unread means: replies to posts I wrote, newer
-- than the last time I looked, that I did not write myself.

alter table public.profiles
  add column mail_seen_at timestamptz not null default now();

comment on column public.profiles.mail_seen_at is
  'Last time they read their mail. Everything newer than this is unread (§4.1).';

-- The reply side of the join is by author; without this every count is a scan.
create index replies_author_recent on public.replies (author_id, created_at desc);
create index posts_author on public.posts (author_id);

-- security definer because the whole point is a count about *you*, derived
-- from rows belonging to other people. auth.uid() means it can only ever be
-- about the caller.
create or replace function public.mail_count ()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(count(*), 0)::integer
    from public.replies r
    join public.posts p on p.id = r.post_id
   where p.author_id = auth.uid ()
     and r.author_id <> auth.uid ()
     and r.created_at > (select mail_seen_at from public.profiles where id = auth.uid ());
$$;

-- Returns the address alongside the words, because §4.1's lean is that mail
-- lists them "with `go <id>` to jump" — a notification you cannot walk to is
-- just an alert.
create or replace function public.mail ()
returns table (
  room       citext,
  post_no    integer,
  author     citext,
  body       text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.room_slug, p.post_no, author.name, r.body, r.created_at
    from public.replies r
    join public.posts p on p.id = r.post_id
    join public.profiles author on author.id = r.author_id
   where p.author_id = auth.uid ()
     and r.author_id <> auth.uid ()
     and r.created_at > (select mail_seen_at from public.profiles where id = auth.uid ())
   order by r.created_at desc
   limit 50;
$$;

create or replace function public.mark_mail_seen ()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid () is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  update public.profiles set mail_seen_at = now() where id = auth.uid ();
end;
$$;

revoke all on function public.mail_count () from public, anon;
revoke all on function public.mail () from public, anon;
revoke all on function public.mark_mail_seen () from public, anon;

grant execute on function public.mail_count () to authenticated;
grant execute on function public.mail () to authenticated;
grant execute on function public.mark_mail_seen () to authenticated;
