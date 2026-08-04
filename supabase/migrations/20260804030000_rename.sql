-- §4.6, revised — rename as often as you like.
--
-- The document leaned "one free rename, ever. Old name stays reserved and dead
-- so nobody can impersonate." Both halves are now decided differently, and the
-- second half is the one that costs something, so it is worth being precise
-- about what was traded.
--
-- Unlimited, because the failure case §4.6 names — "someone who picks badly at
-- 2am is stuck with it, and that's a real reason to leave" — is not a
-- once-per-lifetime event. A cap just moves the trap one step further along.
--
-- Released immediately, because a name nobody is using is a name nobody is
-- using. The cost is real: `posts` join `profiles.name` live, so a rename
-- rewrites attribution on everything you ever said, and the name you leave can
-- be taken by somebody else that minute. Somebody could build trust as
-- `marisol`, rename, and let a stranger inherit every conversation that says
-- "as marisol said".
--
-- So the mitigation is disclosure rather than a lock: a name that changed hands
-- recently says so on the profile of whoever holds it now. That warns the
-- reader, which is where impersonation actually lands, without publishing
-- anybody's old handles — which would defeat the entire point of letting
-- someone walk away from a name they regret.

alter table public.profiles
  add column name_since timestamptz not null default now();

comment on column public.profiles.name_since is
  'When the current name was taken. Feeds the "this name changed hands recently" notice on a profile.';

-- Not readable by anyone. It exists to answer one question — "was this name
-- somebody else's lately?" — and that question is answered by a function that
-- returns a timestamp and never says whose it was.
create table public.name_history (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  name        citext not null,
  held_from   timestamptz not null,
  released_at timestamptz not null default now()
);

create index name_history_name on public.name_history (name, released_at desc);
create index name_history_profile on public.name_history (profile_id, released_at desc);

alter table public.name_history enable row level security;
-- No policies at all, deliberately: with RLS on and nothing granted, the table
-- is invisible to anon and authenticated no matter what future query is written.

/**
 * Has this name been somebody else's recently?
 *
 * Returns when it was released, or null. Never returns who — a profile that
 * published "was xXx_420 until tuesday" would make renaming pointless for the
 * exact person §4.6 is written for.
 */
create or replace function public.name_changed_hands (p_name citext)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(h.released_at)
    from public.name_history h
   where h.name = p_name
     and h.released_at > now() - interval '90 days'
     -- Somebody has to be holding it *now*, and it has to be somebody else.
     -- A name lying unclaimed has not changed hands, and renaming away from a
     -- name and back to it is not a change of hands either.
     and exists (
       select 1 from public.profiles p
        where p.name = p_name and p.id <> h.profile_id
     );
$$;

grant execute on function public.name_changed_hands (citext) to anon, authenticated;

/**
 * The rename itself.
 *
 * security definer, and no UPDATE grant on profiles anywhere, so this is the
 * only way a name can change — which is what makes "record the old one" and
 * "you cannot do this while banned" impossible to route around.
 */
create or replace function public.change_name (p_name citext)
returns citext
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id      uuid := auth.uid ();
  v_current citext;
  v_since   timestamptz;
  v_banned  timestamptz;
  v_recent  integer;
begin
  if v_id is null then
    raise exception 'you have to be signed in to change your name'
      using errcode = 'insufficient_privilege';
  end if;

  select name, name_since, banned_at into v_current, v_since, v_banned
    from public.profiles where id = v_id;

  if v_current is null then
    raise exception 'you do not have a name yet' using errcode = 'no_data_found';
  end if;

  if v_banned is not null then
    raise exception 'you can''t say things here anymore.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_current = p_name then
    raise exception 'that is already your name' using errcode = 'check_violation';
  end if;

  -- Not a cap on how many times you may rename — it is flood protection, the
  -- same as the one on posting. Cycling a name a hundred times an hour is the
  -- only thing this stops, and that is not somebody fixing a 2am mistake.
  select count(*) into v_recent
    from public.name_history
   where profile_id = v_id
     and released_at > now() - interval '1 hour';

  if v_recent >= 5 then
    raise exception 'that is a lot of names in an hour — give it a while'
      using errcode = 'check_violation';
  end if;

  -- Written before the update so that a unique violation on the new name rolls
  -- the history row back with it. A recorded release of a name you still hold
  -- would make it look like it changed hands.
  insert into public.name_history (profile_id, name, held_from)
  values (v_id, v_current, v_since);

  update public.profiles
     set name = p_name, name_since = now()
   where id = v_id;

  return p_name;
exception
  -- The handler rolls the block back, so the history row goes with the failed
  -- update rather than recording the release of a name they still hold.
  when unique_violation then
    raise exception '% is taken', p_name using errcode = 'unique_violation';
end;
$$;

revoke all on function public.change_name (citext) from public, anon;
grant execute on function public.change_name (citext) to authenticated;
