#!/usr/bin/env bash
#
# Applies the schema and the §5 seed content to a hosted Supabase project.
#
#   DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
#     ./scripts/db-deploy.sh
#
# The connection string is in Project Settings -> Database -> Connection string
# -> URI. It contains your database password, so pass it on the command line or
# from a secret store — do not commit it.
#
# Why not `supabase db push`: that applies migrations only. Seeding is a local
# concept in the CLI, so a pushed project comes up with five empty rooms, and
# §5 is blunt about that being worse than having no rooms at all.
#
# Safe to run repeatedly. Each migration is applied at most once and recorded in
# public.applied_migrations, in the same transaction, so a half-finished run
# leaves no migration half-recorded.
#
# A project that predates that table — one whose migrations were pasted into the
# SQL editor by hand, which is every hosted project here — is adopted on the
# first run: each migration is probed for, and the ones already there are
# recorded rather than re-applied. Nothing is run twice, and nothing is skipped.

set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to the project connection string}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/migrations.sh
. "$(dirname "${BASH_SOURCE[0]}")/migrations.sh"

q() { psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -tAc "$1"; }

# The hosted project already has auth.users, auth.uid() and the anon roles, so
# supabase/tests/_shim.sql is deliberately not applied here — it exists only to
# stand those up on a plain Postgres for the test suite.
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -q -c "
  set client_min_messages = warning;
  create table if not exists public.applied_migrations (
    filename   text primary key,
    applied_at timestamptz not null default now()
  );
  revoke all on public.applied_migrations from public, anon, authenticated;"

# Adopt whatever is already here, once. Recording only — nothing is executed.
if [ "$(q 'select count(*) from public.applied_migrations')" = "0" ] &&
   [ "$(q "select to_regclass('public.rooms') is not null")" = "t" ]; then
  echo "existing project — checking which migrations are already applied"
  for migration in "${root}"/supabase/migrations/*.sql; do
    name="$(basename "${migration}")"
    probe="$(probe_for "${name}")" || {
      echo "no probe for ${name} — add one to scripts/migrations.sh" >&2
      exit 1
    }
    if [ "$(q "${probe}")" = "t" ]; then
      echo "  already applied: ${name}"
      q "insert into public.applied_migrations (filename) values ('${name}')
         on conflict do nothing" >/dev/null
    fi
  done
fi

applied_any=0
for migration in "${root}"/supabase/migrations/*.sql; do
  name="$(basename "${migration}")"

  probe_for "${name}" >/dev/null || {
    echo "no probe for ${name} — add one to scripts/migrations.sh" >&2
    exit 1
  }

  if [ "$(q "select exists (select 1 from public.applied_migrations where filename = '${name}')")" = "t" ]; then
    echo "  skipping ${name} (already applied)"
    continue
  fi

  echo "applying ${name}"
  # One transaction per migration: the file and the record of it land together,
  # so an interrupted run cannot leave a migration applied but unrecorded — the
  # state that makes the next run try it again and fail on a duplicate table.
  {
    echo "begin;"
    cat "${migration}"
    echo ";"
    echo "insert into public.applied_migrations (filename) values ('${name}');"
    echo "commit;"
  } | psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -q -f -
  applied_any=1
done

[ "${applied_any}" = "1" ] || echo "  nothing new to apply"

echo "seeding (§5 — the rooms have to arrive warm)"
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -q -f "${root}/supabase/seed.sql"

echo
psql "${DATABASE_URL}" -q -c "
  select r.slug,
         r.ephemeral,
         count(p.id) as posts,
         r.next_post_no as next_address
    from public.rooms r
    left join public.posts p on p.room_slug = r.slug
   group by r.slug, r.ephemeral, r.sort_order, r.next_post_no
   order by r.sort_order;"

echo "done. every room above should have posts in it."
