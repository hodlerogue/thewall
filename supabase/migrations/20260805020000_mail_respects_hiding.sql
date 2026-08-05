-- Mail was the one place the kill switch did not reach.
--
-- `mail()` and `mail_count()` joined replies to posts and filtered on who wrote
-- them, and on nothing else. Neither looked at `hidden_at` — not on the reply,
-- not on the post it hangs under, not on the room it is in. So hiding a post,
-- hiding a reply, or banning somebody (which hides everything they wrote) left
-- every one of those replies sitting in other people's inboxes, still counted in
-- the badge, still delivered on `mail`.
--
-- That is the exact failure §6's manual kill switch exists to prevent, on the
-- one surface that reaches out and taps somebody on the shoulder. Everywhere
-- else — the room listing, a post, search, a profile — hiding worked.
--
-- The lever is used at the moment somebody is being harassed, so "the abuse is
-- gone from the site but still arrives in your notifications" is close to the
-- worst version of getting this wrong.

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
    join public.rooms rm on rm.slug = p.room_slug
    join public.profiles author on author.id = r.author_id
   where p.author_id = auth.uid ()
     and r.author_id <> auth.uid ()
     -- The reply itself, the post it is under, and the room both are in. A
     -- reply under a hidden post is a notification pointing at nothing, and a
     -- closed room is gone for everybody including the person being notified.
     and r.hidden_at is null
     and p.hidden_at is null
     and rm.hidden_at is null
     and r.created_at > (select mail_seen_at from public.profiles where id = auth.uid ())
   order by r.created_at desc
   -- Raised from 50. Reading is what marks mail read, and with newest-first
   -- ordering anything past the cap is older than everything shown — so a cap
   -- that is hit quietly clears replies nobody ever saw. It cannot be avoided
   -- without a per-reply read model, so it is made rarer here and said out loud
   -- in the command when the cap is reached.
   limit 100;
$$;

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
    join public.rooms rm on rm.slug = p.room_slug
   where p.author_id = auth.uid ()
     and r.author_id <> auth.uid ()
     and r.hidden_at is null
     and p.hidden_at is null
     and rm.hidden_at is null
     and r.created_at > (select mail_seen_at from public.profiles where id = auth.uid ());
$$;

-- The count and the listing have to agree, or the badge says 3 and `mail` shows
-- 1. They are separate functions because one is polled and the other is not, so
-- the filters above are the same filters twice on purpose.
