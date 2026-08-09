-- Four thousand characters, and room for more than one paragraph.
--
-- The cap was 2000, and length was never actually the thing stopping a longer
-- piece of writing: the prompt is a single-line `<input>`, so a body could be
-- two thousand characters and had to be one unbroken block. `write` fixes that
-- half; this is the other.
--
-- 4000 rather than "no limit". A limit has to exist — `body` is a `text` column
-- with no ceiling of its own, and the one thing worse than a cap is a room
-- listing that has to load somebody's novel to draw a one-line preview. Four
-- thousand is roughly eight hundred words, which is a long blog post and a very
-- long thing to read on a phone, and it is where the honest ceiling sits.
--
-- The check is on `char_length`, which counts characters rather than bytes, so
-- the limit means the same thing in every language. That was already true and
-- is worth not breaking.

alter table public.posts drop constraint posts_body_length;
alter table public.posts add constraint posts_body_length
  check (char_length(body) between 1 and 4000);

-- Replies get the same ceiling, and that is deliberate rather than tidy. A
-- reply is a contribution like any other — §4.3 makes it addressable now, and
-- the case that argues for four thousand characters in a post (somebody
-- explaining something properly) argues at least as hard for four thousand in
-- the answer to it.
alter table public.replies drop constraint replies_body_length;
alter table public.replies add constraint replies_body_length
  check (char_length(body) between 1 and 4000);

comment on constraint posts_body_length on public.posts is
  'Between 1 and 4000 characters. Stated in three other places — the client '
  'maxLength, friendly() and /about — and lib/data/writer.test.ts reads this '
  'file to check they still agree.';
