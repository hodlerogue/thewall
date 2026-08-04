#!/usr/bin/env bash
#
# Runs the schema tests against a throwaway database.
#
# The tests deliberately mutate state — they allocate post numbers, delete a
# post and check that nothing after it shifts — so every run needs a database
# that starts at the seed. This creates one, applies the real migrations and
# seed to it, runs the tests, and drops it.
#
#   ./scripts/db-test.sh
#
# Against a plain Postgres cluster it first applies supabase/tests/_shim.sql,
# which stands in for auth.users, auth.uid() and the anon/authenticated roles.
# Against a real Supabase database, export SKIP_SHIM=1 — those already exist.

set -euo pipefail

PGHOST="${PGHOST:-/tmp}"
PGPORT="${PGPORT:-55432}"
PGUSER="${PGUSER:-postgres}"
export PGHOST PGPORT PGUSER

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
db="thewall_test_$$"

if ! psql -d postgres -tc 'select 1' >/dev/null 2>&1; then
  echo "no postgres at ${PGHOST}:${PGPORT}." >&2
  echo "start one, or point PGHOST/PGPORT/PGUSER at a database you can create in." >&2
  exit 1
fi

psql -d postgres -q -c "create database ${db}"
trap 'psql -d postgres -q -c "drop database if exists '"${db}"'" >/dev/null 2>&1 || true' EXIT

run() { psql -d "${db}" -v ON_ERROR_STOP=1 -q -f "$1" >/dev/null; }

[ "${SKIP_SHIM:-0}" = "1" ] || run "${root}/supabase/tests/_shim.sql"

for migration in "${root}"/supabase/migrations/*.sql; do
  run "${migration}"
done

run "${root}/supabase/seed.sql"

# Only the assertions and the section headings are interesting; psql's own
# command tags are not.
psql -d "${db}" -v ON_ERROR_STOP=1 -q -t -f "${root}/supabase/tests/schema.test.sql" 2>&1 |
  grep -E 'ok    |FAILED|ERROR|§|all schema tests' |
  sed 's/^psql:[^ ]* //; s/^NOTICE:  //'

# §3.4 under concurrency. The allocator's whole reason for existing is that two
# people posting at the same instant cannot land on the same address, and that
# claim can only be tested with real concurrent sessions rather than SQL.
echo ''
echo '§3.4 — the allocator under concurrent writers'

writers=8
each=12

# One racer per writer, rather than eight sessions sharing an account.
#
# Two reasons, both of them the schema behaving correctly. Contributing is now
# rate limited, and one account firing hundreds of posts in a second is the
# exact thing that bounds — so a shared account would be testing the limiter
# rather than the allocator. And each has to be verified, because §4.7 allows
# one contribution before the link is followed. Eight concurrent writers is
# eight people anyway, which is what the allocator is actually up against.
psql -d "${db}" -q -c "
  insert into auth.users (id, aud, role, email)
  select ('40000000-0000-4000-8000-00000000000' || n)::uuid,
         'authenticated', 'authenticated', 'racer' || n || '@seed.invalid'
    from generate_series(1, ${writers}) n
  on conflict (id) do nothing;

  insert into public.profiles (id, name, verified_at)
  select ('40000000-0000-4000-8000-00000000000' || n)::uuid, 'racer' || n, now()
    from generate_series(1, ${writers}) n
  on conflict (id) do nothing;"

before=$(psql -d "${db}" -tAc "select count(*) from public.posts where room_slug = 'poker'")

seq "${writers}" | xargs -P "${writers}" -I{} psql -d "${db}" -q -c "
  set role authenticated;
  set request.jwt.claim.sub = '40000000-0000-4000-8000-00000000000{}';
  select public.create_post('poker', 'concurrent {} #' || g) from generate_series(1, ${each}) g;
" >/dev/null 2>&1

# Counted against what was already there rather than against the allocator's
# counter: other tests in this run insert into poker directly, and the property
# being checked is only that these writes collided with nothing.
read -r total distinct_addresses <<<"$(psql -d "${db}" -tAF' ' -c \
  "select count(*), count(distinct post_no) from public.posts where room_slug = 'poker'")"
written=$(( total - before ))
expected=$(( writers * each ))

if [ "${total}" = "${distinct_addresses}" ] && [ "${written}" = "${expected}" ]; then
  echo "  ok    ${writers} writers x ${each} posts landed on ${written} addresses, none of them shared"
else
  echo "  FAILED: ${written} posts written (expected ${expected}), ${total} rows on ${distinct_addresses} distinct addresses"
  exit 1
fi

echo ''
echo 'all database tests passed'
