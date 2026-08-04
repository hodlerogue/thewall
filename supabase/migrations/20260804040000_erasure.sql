-- The right to be forgotten, on a schema where deleting the row is the wrong
-- answer.
--
-- `profiles.id` references `auth.users` on delete cascade, and posts and replies
-- reference profiles the same way. So "delete the account" removes every reply
-- other people wrote under their posts, which is somebody else's speech being
-- deleted to satisfy a request that was never about it.
--
-- Erasure is therefore anonymisation, which is what the regulation asks for
-- anyway: the personal data goes — the address, and the handle that identifies
-- them — and the contributions stay, attached to a handle that is nobody. If
-- the person also wants what they said taken down, that is `ban` with post
-- hiding, a separate lever they have to ask for separately.

create or replace function public.forget (p_name citext)
returns citext
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  v_tombname citext;
begin
  select id into v_id from public.profiles where name = p_name;
  if v_id is null then
    raise exception 'no one called %', p_name using errcode = 'no_data_found';
  end if;

  -- Short and random rather than sequential: `deleted_1` next to `deleted_2`
  -- tells you the order people left, which is information about them.
  --
  -- md5 rather than gen_random_bytes because pgcrypto lives in the `extensions`
  -- schema on a hosted project and this function pins search_path to public.
  v_tombname := 'deleted_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);

  -- Every handle they have ever held goes, including the ones in the history
  -- table. Leaving those behind would let name_changed_hands point back at a
  -- person who asked to be gone.
  delete from public.name_history where profile_id = v_id;

  update public.profiles
     set name          = v_tombname,
         name_since    = now(),
         banned_at     = now(),
         banned_reason = 'account closed',
         verified_at   = null
   where id = v_id;

  -- The address is the personal datum that matters most, and it lives in
  -- auth.users rather than here. Overwritten rather than nulled: GoTrue reads
  -- these columns as non-nullable strings, and a null breaks sign-in for
  -- everybody rather than just this row.
  --
  -- On a hosted project auth.users is owned by supabase_auth_admin, which may
  -- refuse this. A half-finished erasure that reported success would be the
  -- worst outcome available, so it warns loudly and names the other route
  -- rather than failing silently or rolling the anonymisation back.
  begin
    update auth.users
       set email              = v_tombname || '@deleted.invalid',
           raw_user_meta_data = '{}'::jsonb,
           raw_app_meta_data  = '{}'::jsonb
     where id = v_id;
  exception
    when insufficient_privilege then
      raise warning 'THE ADDRESS WAS NOT ERASED: this role may not write auth.users. Delete user % through the Auth admin API to finish.', v_id;
  end;

  return v_tombname;
end;
$$;

revoke all on function public.forget (citext) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.forget (citext) to service_role;
  end if;
end
$$;
