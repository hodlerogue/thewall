#!/usr/bin/env bash
#
# Reports what is actually in a project. Read-only — it changes nothing.
#
#   DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
#     ./scripts/db-check.sh
#
# Written because "there's no room called commons" has several possible causes
# and they need different fixes: the schema might be missing, the schema might
# be there with nothing seeded, or the seed might have stopped partway through
# on the auth.users insert — which is the step most likely to be refused on a
# hosted project, since that table is owned by the auth admin role.

set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to the project connection string}"

# shellcheck source=scripts/migrations.sh
. "$(dirname "${BASH_SOURCE[0]}")/migrations.sh"

q() { psql "${DATABASE_URL}" -tAc "$1" 2>/dev/null || echo "ERROR"; }

echo "── schema ──────────────────────────────────────"
for table in rooms posts replies profiles signup_attempts; do
  exists=$(q "select to_regclass('public.${table}') is not null")
  printf "  %-16s %s\n" "${table}" "$([ "${exists}" = "t" ] && echo "present" || echo "MISSING")"
done

view=$(q "select to_regclass('public.room_overview') is not null")
printf "  %-16s %s\n" "room_overview" "$([ "${view}" = "t" ] && echo "present" || echo "MISSING")"

if [ "$(q "select to_regclass('public.rooms') is not null")" != "t" ]; then
  echo
  echo "the schema is not applied. run: ./scripts/db-deploy.sh"
  exit 1
fi

# Which migrations are actually on this project.
#
# "Some of them" is the state a hosted project drifts into — each one gets
# pasted into the SQL editor by hand, and the failure is silent until somebody
# hits the feature. Each row names one object the migration is the only source
# of, so a MISSING line reads directly as "that file was never applied".
echo
echo "── migrations ──────────────────────────────────"

missing=0
for entry in "${MIGRATION_PROBES[@]}"; do
  name="${entry%%|*}"
  present=$(q "${entry#*|}")
  printf "  %-46s %s\n" "${name%.sql}" \
    "$([ "${present}" = "t" ] && echo "applied" || echo "NOT APPLIED")"
  [ "${present}" = "t" ] || missing=$((missing + 1))
done

if [ "${missing}" -gt 0 ]; then
  echo
  echo "${missing} migration(s) missing. the features they add will fail in the browser,"
  echo "not at build time. apply them in filename order:"
  echo
  echo "  DATABASE_URL='...' ./scripts/db-deploy.sh"
fi

# The grant that decides whether anonymous reading works at all. It is the one
# thing a correct-looking schema can still get wrong, and it presents as an
# empty lobby rather than as an error.
echo
echo "── the anon role ───────────────────────────────"
for object in rooms posts replies profiles room_overview; do
  granted=$(q "select has_table_privilege('anon', 'public.${object}', 'select')")
  printf "  %-16s %s\n" "${object}" \
    "$([ "${granted}" = "t" ] && echo "readable" || echo "NOT READABLE")"
done

echo
echo "── content ─────────────────────────────────────"
printf "  %-16s %s\n" "rooms"    "$(q 'select count(*) from public.rooms')"
printf "  %-16s %s\n" "posts"    "$(q 'select count(*) from public.posts')"
printf "  %-16s %s\n" "replies"  "$(q 'select count(*) from public.replies')"
printf "  %-16s %s\n" "profiles" "$(q 'select count(*) from public.profiles')"
printf "  %-16s %s\n" "auth users" "$(q 'select count(*) from auth.users')"

rooms=$(q 'select count(*) from public.rooms')

if [ "${rooms}" = "0" ]; then
  echo
  echo "the schema is there but nothing is seeded."
  users=$(q 'select count(*) from auth.users')
  if [ "${users}" = "0" ] || [ "${users}" = "ERROR" ]; then
    echo "auth.users is empty or unreadable, so the seed most likely stopped on"
    echo "its first statement. Check whether this role may write to auth.users:"
    echo
    echo "  psql \"\$DATABASE_URL\" -c \"insert into auth.users (id, email) values (gen_random_uuid(), 'probe@seed.invalid')\""
    echo
    echo "If that is refused, seed the accounts through the Auth admin API"
    echo "instead — see the note in supabase/seed.sql."
  else
    echo "run: ./scripts/db-deploy.sh"
  fi
  exit 1
fi

echo
echo "── what the lobby will show (§3.11) ────────────"
psql "${DATABASE_URL}" -c "
  select slug,
         ephemeral,
         coalesce(latest_author, '(nobody)') as last_said_by,
         left(coalesce(latest_body, '(empty)'), 40) as last_said
    from public.room_overview
   order by sort_order;"

echo "every room above should have something in the last two columns (§5)."
