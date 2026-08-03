-- §4.7 — unverified posting at launch, with a rate limit on new accounts.
--
-- The flow posts immediately and sends the key in parallel, which means
-- throwaway addresses get in. For a small community that is fine and the manual
-- kill switch covers it; what it cannot absorb is someone minting accounts in a
-- loop. This is the cheap bound that buys time, and the thing to revisit the
-- moment volume makes the kill switch impractical.

create table public.signup_attempts (
  id         bigint generated always as identity primary key,
  -- Hashed rather than stored: the bound needs to distinguish callers, not
  -- identify them, and an unhashed address is a liability with no upside.
  client_hash text not null,
  created_at timestamptz not null default now()
);

create index signup_attempts_recent on public.signup_attempts (client_hash, created_at desc);

-- Only the server, holding the service-role key, ever touches this table.
alter table public.signup_attempts enable row level security;
revoke all on public.signup_attempts from anon, authenticated;

-- Records the attempt and reports whether it is over the line, in one call, so
-- there is no gap between the check and the write for a burst to slip through.
create or replace function public.record_signup_attempt (
  p_client_hash text,
  p_limit integer default 5,
  p_window interval default interval '1 hour'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent integer;
begin
  insert into public.signup_attempts (client_hash) values (p_client_hash);

  select count(*) into v_recent
    from public.signup_attempts
   where client_hash = p_client_hash
     and created_at > now() - p_window;

  return v_recent <= p_limit;
end;
$$;

revoke all on function public.record_signup_attempt (text, integer, interval) from public, anon, authenticated;

-- Keeps the table from growing without bound. Run from a scheduled job, or by
-- hand — there is no cron in scope at launch (§6).
create or replace function public.prune_signup_attempts ()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.signup_attempts where created_at < now() - interval '7 days';
$$;

revoke all on function public.prune_signup_attempts () from public, anon, authenticated;
