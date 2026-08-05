#!/usr/bin/env bash
#
# The kill switch, as something you can actually reach at 2am.
#
# §6 puts moderation tooling out of scope "beyond a manual kill switch". This is
# the manual part: the levers live in the database as service-role functions,
# and this is the memory of what they are called and what the arguments mean.
# There is no admin account and no in-app moderation surface on purpose — an
# admin bit that a signed-in user can be checked against is an escalation target
# that buys nothing when the operator is one person with psql (§7).
#
#   DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
#     ./scripts/moderate.sh <command> [args]
#
# Everything here is reversible. Nothing deletes anything: a hidden post keeps
# its row, its address and its replies (§3.4), and a banned account keeps its
# name, so the handle stays reserved and dead rather than being freed for
# whoever wants it next (§4.6).

set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to the project connection string}"

q() { psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -tAc "$1"; }

# Single-quoted SQL literal, so a name with an apostrophe cannot end the string.
lit() { printf "'%s'" "${1//\'/\'\'}"; }

usage() {
  cat <<'TXT'
usage: ./scripts/moderate.sh <command> [args]

  who                          who has been banned, and what is hidden
  look <name>                  everything one person has said, hidden or not

  ban <name> [reason]          stop them contributing and hide what they said
  ban-only <name> [reason]     stop them, leave what they said in place
  unban <name>                 undo both

  hide <room> <number>         soft-delete one post, replies included
  show <room> <number>         put it back
  hide-reply <id>              soft-delete a single reply
  show-reply <id>              put it back

  close <room>                 the room and everything in it stop existing
  open <room>                  put it back

  new-room <slug> <gloss>      make a room. §4.2 leans against this — read the
                               note under `new-room` in CHANGING-IT.md first
  post-as <room> <name> <body> put the first thing in it, under a real name


  forget <name>                erasure request: address and handle erased
                               permanently, what they posted left standing so
                               other people's replies survive. irreversible.

  archive [interval]           §4.2 decay, run by hand: quiet rooms leave the
                               lobby but stay reachable. default 7 days.
                               posting in one brings it straight back.

Reply ids come from `look`. Post numbers are the ones people type (§3.4).
TXT
}

command="${1:-}"
shift || true

case "${command}" in
  who)
    echo "── banned ──────────────────────────────────────"
    psql "${DATABASE_URL}" -c "
      select name, banned_at, coalesce(banned_reason, '(no reason recorded)') as reason
        from public.profiles where banned_at is not null order by banned_at desc;"
    echo "── hidden ──────────────────────────────────────"
    psql "${DATABASE_URL}" -c "
      select room_slug, post_no, left(body, 48) as body, hidden_at
        from public.posts where hidden_at is not null order by hidden_at desc limit 40;"
    psql "${DATABASE_URL}" -c "
      select slug, hidden_at, archived_at from public.rooms
       where hidden_at is not null or archived_at is not null;"
    ;;

  look)
    name="${1:?usage: look <name>}"
    psql "${DATABASE_URL}" -c "
      select p.room_slug || '/' || p.post_no as address,
             case when p.hidden_at is null then 'visible' else 'hidden' end as state,
             p.created_at, left(p.body, 60) as body
        from public.posts p join public.profiles a on a.id = p.author_id
       where a.name = $(lit "${name}") order by p.created_at desc limit 40;"
    psql "${DATABASE_URL}" -c "
      select r.id as reply_id,
             p.room_slug || '/' || p.post_no as under,
             case when r.hidden_at is null then 'visible' else 'hidden' end as state,
             left(r.body, 60) as body
        from public.replies r
        join public.posts p on p.id = r.post_id
        join public.profiles a on a.id = r.author_id
       where a.name = $(lit "${name}") order by r.created_at desc limit 40;"
    ;;

  ban)
    name="${1:?usage: ban <name> [reason]}"; shift
    reason="${*:-}"
    hidden=$(q "select public.ban($(lit "${name}"), nullif($(lit "${reason}"), ''), true)")
    echo "banned ${name}; hid ${hidden} of their posts. undo with: unban ${name}"
    ;;

  ban-only)
    name="${1:?usage: ban-only <name> [reason]}"; shift
    reason="${*:-}"
    q "select public.ban($(lit "${name}"), nullif($(lit "${reason}"), ''), false)" >/dev/null
    echo "banned ${name}; what they said is still there. undo with: unban ${name}"
    ;;

  unban)
    name="${1:?usage: unban <name>}"
    restored=$(q "select public.unban($(lit "${name}"), true)")
    echo "unbanned ${name}; restored ${restored} posts."
    ;;

  hide|show)
    room="${1:?usage: ${command} <room> <number>}"
    number="${2:?usage: ${command} <room> <number>}"
    hide=$([ "${command}" = "hide" ] && echo true || echo false)
    n=$(q "select public.hide_post($(lit "${room}"), ${number}, ${hide})")
    [ "${n}" = "1" ] && echo "${room}/${number} is now $([ "${hide}" = true ] && echo hidden || echo visible)." \
      || echo "nothing changed — ${room}/${number} was already that way, or is not there."
    ;;

  hide-reply|show-reply)
    id="${1:?usage: ${command} <reply id>}"
    hide=$([ "${command}" = "hide-reply" ] && echo true || echo false)
    n=$(q "select public.hide_reply(${id}, ${hide})")
    [ "${n}" = "1" ] && echo "reply ${id} is now $([ "${hide}" = true ] && echo hidden || echo visible)." \
      || echo "nothing changed — reply ${id} was already that way, or is not there."
    ;;

  close|open)
    room="${1:?usage: ${command} <room>}"
    hide=$([ "${command}" = "close" ] && echo true || echo false)
    n=$(q "select public.hide_room($(lit "${room}"), ${hide})")
    [ "${n}" = "1" ] && echo "${room} is now $([ "${hide}" = true ] && echo closed || echo open)." \
      || echo "nothing changed — ${room} was already that way, or is not there."
    ;;

  new-room)
    slug="${1:?usage: new-room <slug> <gloss>}"; shift
    gloss="${*:?usage: new-room <slug> <gloss>}"

    # Both of these are check constraints, so the database refuses them anyway.
    # They are here to refuse them in a sentence rather than in a constraint
    # name, which is the whole reason this script exists (§3.7 applies to the
    # operator too — they are the person awake at 2am).
    case "${slug}" in
      '~'*) echo "~ names a wall, and walls make themselves. pick a plain name." >&2; exit 1 ;;
    esac
    [[ "${slug}" =~ ^[a-z0-9-]{2,24}$ ]] || {
      echo "a room slug is 2-24 characters of a-z, 0-9 and -. got: ${slug}" >&2; exit 1
    }

    # sort_order goes to the end rather than being asked for. The lobby order is
    # a curation decision and the last position is the only one that is right by
    # default — inserting into the middle silently demotes something.
    # Wrapped in a CTE so the statement psql runs is a SELECT.
    # `insert ... returning` through `psql -tAc` prints the command tag
    # ("INSERT 0 0") when nothing was inserted, which is a non-empty string —
    # so the "did it happen" check below read a no-op as a success and this
    # reported a room created every time it ran.
    # curated = true, which is the whole difference between this and `make`.
    # A room the operator opens is furniture: always in the lobby, never faded.
    # sort_order counts over the curated block only — user rooms sit at 500 and
    # would otherwise push every future curated room past them.
    made=$(q "
      with made as (
        insert into public.rooms (slug, gloss, ephemeral, sort_order, curated)
        select $(lit "${slug}"), $(lit "${gloss}"), false,
               coalesce((select max(sort_order) + 1 from public.rooms
                          where owner_id is null and curated), 0),
               true
        on conflict (slug) do nothing
        returning slug
      )
      select slug from made")

    [ -n "${made}" ] || { echo "${slug} already exists. see it with: who"; exit 1; }

    echo "${slug} is open, at the end of the lobby."
    echo
    # §5, and it is not a nicety: "an empty room is worse than no room. the
    # demo cannot launch to a ghost town." A room created and left empty reads
    # as a dead site rather than a new topic, and it is the operator who has to
    # fix that within the hour.
    echo "it is empty, which §5 calls worse than not having it. put something in it:"
    echo "  ./scripts/moderate.sh post-as ${slug} <your name> 'the first thing'"
    echo
    echo "this room lives only in this database. to have it in the demo, the"
    echo "e2e suite and every future deploy, add it to supabase/seed.sql and"
    echo "lib/shell/fixtures.ts as well — see CHANGING-IT.md."
    ;;

  post-as)
    room="${1:?usage: post-as <room> <name> <body>}"; shift
    name="${1:?usage: post-as <room> <name> <body>}"; shift
    body="${*:?usage: post-as <room> <name> <body>}"

    # Checked first so a missing name cannot burn an address. Numbers are never
    # reused (§3.4), so a bumped counter with no post behind it leaves a
    # permanent hole in a room's numbering for a typo.
    exists=$(q "select 1 from public.profiles where name = $(lit "${name}")")
    [ -n "${exists}" ] || { echo "there is nobody called ${name}." >&2; exit 1; }

    # The counter bump and the insert are one statement, because the allocator
    # is the database's job and this is the one place outside create_post() that
    # touches it. Clearing archived_at matches what posting normally does: §4.2
    # decay is undone by somebody speaking, and this is somebody speaking.
    number=$(q "
      with taken as (
        update public.rooms
           set next_post_no = next_post_no + 1,
               archived_at  = null
         where slug = $(lit "${room}") and hidden_at is null
        returning slug, next_post_no - 1 as post_no
      ), written as (
        insert into public.posts (room_slug, post_no, author_id, body)
        select taken.slug, taken.post_no, p.id, $(lit "${body}")
          from taken, public.profiles p
         where p.name = $(lit "${name}")
        returning post_no
      )
      select post_no from written")

    [ -n "${number}" ] || { echo "no room called ${room}, or it is closed." >&2; exit 1; }

    echo "${room}/${number} — posted as ${name}."
    # Said out loud because it is the one lever here that puts words in
    # somebody's mouth. Every other command hides or restores what people
    # actually wrote.
    echo "that is now a real post under a real name. undo with: hide ${room} ${number}"
    ;;

  forget)
    name="${1:?usage: forget <name>}"
    # The one command here that cannot be undone, so it asks. Everything else
    # is a soft delete with an inverse; this deliberately is not, because a
    # deletion you can reverse is not a deletion.
    printf 'erase %s permanently? their address and handle go for good. [type the name to confirm] ' "${name}"
    read -r confirm
    [ "${confirm}" = "${name}" ] || { echo "nothing done."; exit 1; }

    tomb=$(q "select public.forget($(lit "${name}"))")
    echo "erased. what they posted now belongs to ${tomb}, which is nobody."
    echo "if they also asked for their posts taken down, that is: ban ${tomb}"
    ;;

  archive)
    idle="${1:-7 days}"
    n=$(q "select public.archive_quiet_rooms(interval $(lit "${idle}"))")
    echo "archived ${n} room(s) with nothing said in ${idle}."
    echo "they are still reachable by name, and come back the moment somebody posts."
    ;;

  ''|-h|--help|help) usage ;;
  *) usage; exit 1 ;;
esac
