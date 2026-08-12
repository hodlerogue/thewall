-- /hello is the landing page now, so nobody may take it as a room name.
--
-- In its own migration rather than added to the insert that created the table:
-- that one may already be applied, and a row added to an applied file never
-- runs. This is the rule `CHANGING-IT.md` states for adding a route, followed.
--
-- A room called `hello` would be shadowed by the page forever — `go hello`
-- would work, thewall.social/hello would not be the room, and §3.4's "the
-- prompt path is the URL" would be quietly false for exactly one room.
insert into public.reserved_slugs (slug, reason)
values ('hello', 'that is a route')
on conflict (slug) do nothing;
