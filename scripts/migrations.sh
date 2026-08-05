#!/usr/bin/env bash
#
# One object per migration that only that migration creates.
#
# Sourced by db-deploy.sh and db-check.sh so the two can never disagree about
# what "applied" means. It exists because a hosted project does not get its
# migrations from a CLI — they are pasted into the SQL editor one at a time, by
# hand, at whatever moment each was written. So "some of them" is the normal
# state, and every probe here is the difference between a feature working and a
# feature failing silently in somebody's browser.
#
# Adding a migration means adding a line. The check in db-deploy.sh will fail
# loudly if you forget, rather than skipping your migration forever.

MIGRATION_PROBES=(
  "20260803000000_initial_schema.sql|select to_regproc('public.create_post') is not null"
  "20260803010000_signup_rate_limit.sql|select to_regclass('public.signup_attempts') is not null"
  "20260803020000_verify_to_continue.sql|select exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'verified_at')"
  "20260804000000_column_scoped_grants.sql|select to_regproc('public.mark_verified') is not null"
  "20260804010000_mail.sql|select to_regproc('public.mail_count') is not null"
  "20260804020000_moderation.sql|select to_regproc('public.hide_post') is not null"
  "20260804030000_rename.sql|select to_regproc('public.change_name') is not null"
  "20260804040000_erasure.sql|select to_regproc('public.forget') is not null"
  "20260804050000_walls.sql|select exists (select 1 from information_schema.columns where table_name = 'rooms' and column_name = 'owner_id')"
  "20260805000000_user_rooms.sql|select to_regproc('public.create_room') is not null"
  "20260805010000_terms_accepted.sql|select exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'terms_accepted_at')"
  # No new object — this one re-creates two functions. Probed by behaviour
  # instead: the fixed version joins rooms, so its definition mentions it.
  "20260805020000_mail_respects_hiding.sql|select pg_get_functiondef('public.mail_count()'::regprocedure) like '%hidden_at%'"
  "20260805030000_about_is_a_route.sql|select exists (select 1 from public.reserved_slugs where slug = 'about')"
)

probe_for() {
  local wanted="$1" entry
  for entry in "${MIGRATION_PROBES[@]}"; do
    if [ "${entry%%|*}" = "${wanted}" ]; then
      printf '%s' "${entry#*|}"
      return 0
    fi
  done
  return 1
}
