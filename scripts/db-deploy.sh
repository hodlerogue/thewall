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
# This is a first-run script. The migrations create tables, so running it twice
# against the same project will fail on the second pass — which is the intended
# behaviour, not a bug to work around.

set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to the project connection string}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The hosted project already has auth.users, auth.uid() and the anon roles, so
# supabase/tests/_shim.sql is deliberately not applied here — it exists only to
# stand those up on a plain Postgres for the test suite.
for migration in "${root}"/supabase/migrations/*.sql; do
  echo "applying $(basename "${migration}")"
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -q -f "${migration}"
done

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
