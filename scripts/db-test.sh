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

# ---------------------------------------------------------------------------
# Moving a project to a new Supabase account (scripts/db-move.sql)
# ---------------------------------------------------------------------------
#
# A real move between two databases, because reading the script was not
# enough: it renumbered every reply on arrival and dropped what each one
# answered, the paste succeeded, and part three's counts matched. Found only
# by actually moving a thread with a gap in it.
#
# So the old project gets the shape that broke it — a reply erased, and a
# reply answering another across that gap — and part three's fingerprints
# must come out identical on both sides.
echo ''
echo 'scripts/db-move.sql — moving to a new account'

# Two fresh projects rather than the one the tests above have been using.
# That one is full of deliberately strange states — closed accounts, banned
# ones, and test accounts on `@seed.invalid` that made rooms — and the move
# script rightly assumes a real project's only `@seed.invalid` accounts are the
# seed's five. A move is something done to a project people used, so the old
# side here is a clean install plus what people do.
old="${db}_old"
new="${db}_moved"
trap 'for d in "'"${db}"'" "'"${old}"'" "'"${new}"'"; do psql -d postgres -q -c "drop database if exists $d" >/dev/null 2>&1 || true; done' EXIT

for target in "${old}" "${new}"; do
  psql -d postgres -q -c "create database ${target}"
  [ "${SKIP_SHIM:-0}" = "1" ] || psql -d "${target}" -v ON_ERROR_STOP=1 -q -f "${root}/supabase/tests/_shim.sql" >/dev/null
  for migration in "${root}"/supabase/migrations/*.sql; do
    psql -d "${target}" -v ON_ERROR_STOP=1 -q -f "${migration}" >/dev/null
  done
  psql -d "${target}" -v ON_ERROR_STOP=1 -q -f "${root}/supabase/seed.sql" >/dev/null
done

# Real accounts as far as the move is concerned (not `@seed.invalid`), so they
# have to come across for their replies to have an author on the other side —
# which also checks that accounts themselves survive.
psql -d "${old}" -v ON_ERROR_STOP=1 -q -c "
  insert into auth.users (id, aud, role, email)
  select ('50000000-0000-4000-8000-00000000000' || n)::uuid,
         'authenticated', 'authenticated', 'mover' || n || '@move.invalid'
    from generate_series(1, 3) n;

  insert into public.profiles (id, name, verified_at)
  select ('50000000-0000-4000-8000-00000000000' || n)::uuid, 'mover' || n, now()
    from generate_series(1, 3) n;

  with p as (select id from public.posts where room_slug = 'music' and post_no = 12)
  insert into public.replies (post_id, author_id, body)
  select p.id, '50000000-0000-4000-8000-000000000001', 'move test: answered across a gap' from p;

  with p as (select id from public.posts where room_slug = 'music' and post_no = 12)
  insert into public.replies (post_id, author_id, body)
  select p.id, '50000000-0000-4000-8000-000000000002', 'move test: about to be erased' from p;

  with p as (select id from public.posts where room_slug = 'music' and post_no = 12),
       a as (select reply_no from public.replies where body = 'move test: answered across a gap')
  insert into public.replies (post_id, author_id, body, to_reply_no)
  select p.id, '50000000-0000-4000-8000-000000000003', 'move test: the answer', a.reply_no from p, a;

  delete from public.replies where body = 'move test: about to be erased';

  insert into public.rooms (slug, gloss, ephemeral, sort_order, created_by)
  values ('pulsechain', 'decentralized blockchain talk', false, 500,
          '50000000-0000-4000-8000-000000000001');
  insert into public.posts (room_slug, post_no, author_id, body)
  values ('pulsechain', 1, '50000000-0000-4000-8000-000000000002', 'move test: first post in a room somebody made');
  update public.rooms set next_post_no = 2 where slug = 'pulsechain';"

move="${root}/scripts/db-move.sql"
section() { awk -v start="^-- PART $1" -v stop="^-- PART $2" '$0 ~ start {on=1} stop != "^-- PART " && $0 ~ stop {exit} on' "${move}"; }

section ONE TWO | psql -d "${old}" -tA -q | psql -d "${new}" -v ON_ERROR_STOP=1 -q >/dev/null
section TWO THREE | psql -d "${new}" -v ON_ERROR_STOP=1 -q >/dev/null

before_move=$(section THREE '' | psql -d "${old}" -tA -F'|')
after_move=$(section THREE '' | psql -d "${new}" -tA -F'|')

if [ "${before_move}" = "${after_move}" ]; then
  echo "  ok    every count, fingerprint and allocator check matches on both sides"
else
  echo "  FAILED: part three differs after a move"
  diff <(echo "${before_move}") <(echo "${after_move}") | sed 's/^/          /'
  exit 1
fi

answers=$(psql -d "${new}" -tAc "
  select x.reply_no || '>' || x.to_reply_no from public.replies x
   where x.body = 'move test: the answer'")
answered=$(psql -d "${old}" -tAc "
  select x.reply_no || '>' || x.to_reply_no from public.replies x
   where x.body = 'move test: the answer'")
if [ -n "${answers}" ] && [ "${answers}" = "${answered}" ]; then
  echo "  ok    a reply keeps its number and what it answers, across an erased one (${answers})"
else
  echo "  FAILED: the answering reply was ${answered:-missing} and arrived as ${answers:-nothing}"
  exit 1
fi

made=$(psql -d "${new}" -tAc "
  select r.gloss || ' / ' || p.body from public.rooms r
    join public.posts p on p.room_slug = r.slug and p.post_no = 1
   where r.slug = 'pulsechain' and r.created_by is not null")
if [ "${made}" = "decentralized blockchain talk / move test: first post in a room somebody made" ]; then
  echo "  ok    a room somebody made arrives with its maker, its description and its posts"
else
  echo "  FAILED: the made room arrived as '${made:-nothing}'"
  exit 1
fi

echo ''
echo 'all database tests passed'
