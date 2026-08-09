-- No mail to an address that cannot receive it.
--
-- Found while working out what a public repository changes about this project,
-- and it turned out to be a live defect rather than a disclosure: the five
-- accounts `seed.sql` creates live at `@seed.invalid`, a TLD the standards
-- reserve so that it can never resolve. They are verified, their posts are in
-- the lobby, and the daily email is on by default — so the first time a real
-- person answers jameson, the digest job tries `jameson@seed.invalid`, and
-- tries again every day there is something new.
--
-- Every one of those is a hard bounce. Hard bounces are what gets a sending
-- domain throttled or cut off, and they cost most on a domain that has just
-- been warmed, which is the state this one is in. The failure is not that the
-- seed accounts miss their email — it is that everybody else stops getting
-- sign-in keys.
--
-- The public repository is what made the second half of it reachable on
-- purpose: the seeded names are printed on the site and written down in a
-- readable repo, so `login jameson` is something anyone can type, and each
-- attempt is another bounce. That route is guarded in
-- lib/auth/deliverable.ts; this file guards the one nobody is watching.

create or replace function public.pending_digests ()
returns table (
  profile_id uuid,
  name       citext,
  email      text,
  unread     integer,
  token      uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.name,
         u.email::text,
         count(r.*)::integer,
         n.token
    from public.notify_settings n
    join public.profiles p on p.id = n.profile_id
    join auth.users u on u.id = p.id
    join public.posts po on po.author_id = p.id
    join public.rooms rm on rm.slug = po.room_slug
    join public.replies r on r.post_id = po.id
   where n.daily
     and p.banned_at is null
     and p.verified_at is not null
     and u.email is not null
     /*
      * Never to an address that provably cannot receive.
      *
      * RFC 2606 and RFC 6761 reserve these so they can never resolve, which is
      * exactly why `seed.sql` uses `@seed.invalid` for its five accounts. Those
      * accounts are verified, their posts sit in the lobby, and the digest is
      * on by default — so the first time a real person answers jameson, this
      * query hands the job `jameson@seed.invalid` and keeps doing it every day
      * there is something new. Every one is a hard bounce against a sending
      * domain that has only just been warmed, and a steady trickle of those is
      * a suspended account and no sign-in keys for anybody.
      *
      * Here as well as in lib/auth/deliverable.ts, because the two decide
      * different sends: that one guards a route somebody types at, this one
      * guards a cron job nobody is watching.
      */
     and u.email !~* '(@|\.)(example\.com|example\.net|example\.org)$'
     and u.email !~* '\.(test|example|invalid|localhost)$'
     and (n.notified_at is null or n.notified_at < now() - interval '20 hours')
     -- The same three the badge uses: a reply under a hidden post, or in a
     -- closed room, is a notification pointing at nothing.
     and r.hidden_at is null
     and po.hidden_at is null
     and rm.hidden_at is null
     and r.author_id <> p.id
     and r.created_at > p.mail_seen_at
   group by p.id, p.name, u.email, n.token, n.notified_at
  /*
   * Two different questions, and the first version answered only one.
   *
   * `unread` is everything waiting, so the number in the email is the number in
   * the badge. Whether to send at all is a different question: has anything
   * arrived *since the last email*. Gating on unread alone meant somebody who
   * got a digest and never read their mail was sent the identical email every
   * day for as long as the pile sat there — which is precisely the daily nag
   * this feature is written to not be, and it contradicted the sentence the
   * command itself prints.
   *
   * `greatest` ignores nulls, so a first-ever send compares against
   * `mail_seen_at` alone and everything unread counts as new.
   */
  having count(*) filter (
    where r.created_at > greatest(p.mail_seen_at, n.notified_at)
  ) > 0;
$$;

-- Belt as well as braces: the seeded accounts are switched off explicitly.
--
-- The filter above is the rule and this is not a second copy of it — it is a
-- statement about these five in particular, who did not ask for email and could
-- not read it if they got it. `notify_default` gives every new profile a row
-- saying on, and the seed makes profiles, so without this they are enrolled
-- like everybody else and only the query above stands between them and a send.
update public.notify_settings n
   set daily = false
  from auth.users u
 where u.id = n.profile_id
   and u.email like '%@seed.invalid';
