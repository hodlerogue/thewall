-- Test-only shim. NOT a migration, and never applied to a real project.
--
-- Supabase provides `auth.users`, `auth.uid()`, the anon/authenticated roles
-- and the `supabase_realtime` publication. A plain Postgres cluster does not,
-- so this recreates just enough of them to run `20260803000000_initial_schema.sql`
-- unmodified and exercise its RLS policies for real.

create schema if not exists auth;

create table if not exists auth.users (
  id          uuid primary key,
  instance_id uuid,
  aud         text,
  role        text,
  email       text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Supabase reads the subject out of the request JWT claims. Tests set the same
-- GUC, so `auth.uid()` behaves exactly as it does in production.
create or replace function auth.uid ()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

grant usage on schema public, auth to anon, authenticated;
