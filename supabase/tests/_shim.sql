-- Test-only shim. NOT a migration, and never applied to a real project.
--
-- Supabase provides `auth.users`, `auth.uid()`, the anon/authenticated roles
-- and the `supabase_realtime` publication. A plain Postgres cluster does not,
-- so this recreates just enough of them to run `20260803000000_initial_schema.sql`
-- unmodified and exercise its RLS policies for real.

create schema if not exists auth;

-- Mirrors the columns the seed actually writes, including the token columns
-- that real Auth reads as non-nullable strings. A narrower table here would
-- let a seed pass locally and then break against a real project — which is
-- exactly the kind of "tested" that isn't.
create table if not exists auth.users (
  id                     uuid primary key,
  instance_id            uuid,
  aud                    text,
  role                   text,
  email                  text unique,
  encrypted_password     text,
  email_confirmed_at     timestamptz,
  confirmation_token     text default '',
  recovery_token         text default '',
  email_change           text default '',
  email_change_token_new text default '',
  raw_app_meta_data      jsonb default '{}'::jsonb,
  raw_user_meta_data     jsonb default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
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
  -- The moderation levers are granted to this and nothing else, so a cluster
  -- without it would silently test a grant that was never made.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

grant usage on schema public, auth to anon, authenticated, service_role;

-- The part that is easy to leave out, and that made every grant assertion in
-- this suite optimistic.
--
-- A Supabase project ships with these default privileges already set, so every
-- table, function and sequence a migration creates in `public` is born with
-- ALL granted to anon and authenticated. A plain Postgres cluster has no such
-- thing: there, a table is born with no grants at all, and a migration that
-- forgets to revoke looks identical to one that had nothing to revoke.
--
-- So the suite was measuring a permission matrix that will never exist on the
-- real project. It certified the grants were tight while production would have
-- handed `anon` INSERT, UPDATE, DELETE and TRUNCATE on every table — and
-- TRUNCATE is not filtered by row-level security, so `truncate posts cascade`
-- from the anon key emptied the site.
--
-- Setting them here means the migrations have to actually take the privileges
-- away, and the assertions below can tell whether they did.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
