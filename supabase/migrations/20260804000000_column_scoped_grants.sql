-- Closing two holes that defeat controls this schema claims to enforce.
--
-- Root cause, both times: `grant update on <table> to authenticated` is
-- table-wide, while the policy only checks *row* ownership. A user may
-- therefore change any column of their own row. The policies were written as
-- if they constrained what could change; they only constrain whose row it is.
--
-- What that allowed, from the browser console with the anon key that is
-- already in the bundle:
--
--   update profiles set verified_at = now() where id = <me>
--     → may_contribute() true forever. The whole §4.7 gate, which the previous
--       migration exists to add, bypassed without touching email.
--
--   update posts set created_at = now() + interval '1 year' where id = <mine>
--     → is_visible() never expires it. §3.10's "commons is structurally
--       incapable of keeping anything" was simply false, and with no DELETE
--       policy nobody could remove the result through the app.
--
-- The same grant also allowed silent retroactive edits of a post's body, moving
-- a post between rooms, and squatting an unallocated post_no — which later
-- makes create_post fail on the unique constraint for everybody.

-- Nothing in the product edits a post or a name. There is no `edit` verb and
-- no `rename` verb in the command registry, so these grants bought nothing and
-- cost everything. §4.6's one-free-rename will add back exactly one column,
-- through a function that can enforce "once".
revoke update on public.posts from authenticated;
revoke update on public.profiles from authenticated;

drop policy if exists "you may edit your own posts" on public.posts;
drop policy if exists "you may edit your own profile" on public.profiles;

-- Verification is now the database's to record, not the client's to assert.
--
-- /auth/callback used to write verified_at through the user's own session,
-- which is precisely why the grant had to exist. Moving it here lets the grant
-- go: security definer runs as the owner, and auth.uid() means a caller can
-- only ever mark themselves.
create or replace function public.mark_verified ()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid () is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  update public.profiles
     set verified_at = now()
   where id = auth.uid ()
     and verified_at is null;
end;
$$;

revoke all on function public.mark_verified () from public, anon;
grant execute on function public.mark_verified () to authenticated;

-- Bodies -------------------------------------------------------------------
-- Length-only validation let two dumb things through: a whitespace-only post,
-- which permanently consumes an address and renders as a blank entry, and a
-- post of two thousand newlines, which is the closest thing this design has to
-- a griefing primitive — it floods a scrollback and needs no automation.

alter table public.posts
  add constraint posts_body_not_blank check (char_length(btrim(body)) > 0),
  add constraint posts_body_line_limit
    check (char_length(body) - char_length(replace(body, E'\n', '')) <= 20);

alter table public.replies
  add constraint replies_body_not_blank check (char_length(btrim(body)) > 0),
  add constraint replies_body_line_limit
    check (char_length(body) - char_length(replace(body, E'\n', '')) <= 20);

-- Rate limiting, generalised --------------------------------------------------
-- §4.7 bounded new accounts and nothing else. /api/verify/resend then arrived
-- with no bound at all: every call mints a link and sends real mail, so a loop
-- burns the mail provider's quota in a minute and can be pointed at a stranger's
-- address, because signup never proves ownership. Supabase's own email throttle
-- does not apply, since generateLink mints without sending.

alter table public.signup_attempts
  add column kind text not null default 'signup';

drop index if exists signup_attempts_recent;
create index signup_attempts_recent
  on public.signup_attempts (kind, client_hash, created_at desc);

create or replace function public.record_attempt (
  p_kind        text,
  p_client_hash text,
  p_limit       integer default 5,
  p_window      interval default interval '1 hour'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent integer;
begin
  -- Recorded and counted in one call, so a burst cannot slip between the
  -- check and the write.
  insert into public.signup_attempts (kind, client_hash) values (p_kind, p_client_hash);

  select count(*) into v_recent
    from public.signup_attempts
   where kind = p_kind
     and client_hash = p_client_hash
     and created_at > now() - p_window;

  return v_recent <= p_limit;
end;
$$;

revoke all on function public.record_attempt (text, text, integer, interval)
  from public, anon, authenticated;

-- Kept so the signup route needs no change, and so the name still says what it
-- is for at the call site.
create or replace function public.record_signup_attempt (
  p_client_hash text,
  p_limit integer default 5,
  p_window interval default interval '1 hour'
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.record_attempt ('signup', p_client_hash, p_limit, p_window);
$$;

revoke all on function public.record_signup_attempt (text, integer, interval)
  from public, anon, authenticated;
