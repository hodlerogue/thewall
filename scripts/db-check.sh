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
