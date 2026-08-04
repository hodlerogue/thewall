-- §4.7, revised.
--
-- The document weighed unverified posting purely as a moderation question:
-- throwaway addresses, the manual kill switch, abuse at scale. It never asked
-- whether someone can come back *as themselves*, and that turns out to be the
-- sharper problem. An unverified address may be a typo or invented, so a magic
-- link sent to it is not a recovery path — on a second device the only reliable
-- move is to sign up again. Since names are uniquely reserved forever (§4.6),
-- every abandoned account permanently burns a handle in a community where the
-- handle *is* the identity. Identity that does not survive the trip also makes
-- §4.1's notifications pointless before they are even built.
--
-- The resolution keeps §3.9 whole: the held sentence still posts the instant
-- the account exists, because that moment is the best thing in the design.
-- Everything after it asks you to click the link first. The friction lands
-- after the payoff rather than in front of it, which is also what makes the
-- link necessary rather than decorative.

-- Our own signal, deliberately not auth.users.email_confirmed_at.
--
-- Signup mints a session immediately, and the only way to do that confirms the
-- address as a side effect — so GoTrue's flag says "confirmed" for an address
-- nobody has ever proven they can read. This column means something narrower
-- and true: they clicked a link that arrived in that inbox.
alter table public.profiles
  add column verified_at timestamptz;

comment on column public.profiles.verified_at is
  'When they followed a link sent to their address. Null means unverified: one contribution, then they are asked.';

-- One contribution before verifying — that is the §3.9 held message and
-- nothing more.
create or replace function public.may_contribute (p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select verified_at is not null from public.profiles where id = p_user), false)
    or (
      (select count(*) from public.posts where author_id = p_user)
      + (select count(*) from public.replies where author_id = p_user)
    ) = 0;
$$;

grant execute on function public.may_contribute (uuid) to authenticated;

-- Enforced here rather than in the client for the same reason the other two
-- invariants are: a rule that lives in application code is a rule every future
-- caller has to remember.
create or replace function public.create_post (p_room citext, p_body text)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_no integer;
  v_post    public.posts;
begin
  if auth.uid () is null then
    raise exception 'you have to be signed in to say something'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.may_contribute (auth.uid ()) then
    raise exception 'check your email to keep saying things'
      using errcode = 'insufficient_privilege';
  end if;

  update public.rooms
     set next_post_no = next_post_no + 1
   where slug = p_room
  returning next_post_no - 1 into v_post_no;

  if v_post_no is null then
    raise exception 'no room called %', p_room using errcode = 'no_data_found';
  end if;

  insert into public.posts (room_slug, post_no, author_id, body)
  values (p_room, v_post_no, auth.uid (), p_body)
  returning * into v_post;

  return v_post;
end;
$$;

revoke all on function public.create_post (citext, text) from public;
grant execute on function public.create_post (citext, text) to authenticated;

-- Replies are inserted directly, so they need their own gate. This runs before
-- the ephemeral-room check, which is the right order: "verify first" is the
-- more useful thing to hear.
create or replace function public.require_contribution_allowed ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.may_contribute (new.author_id) then
    raise exception 'check your email to keep saying things'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger replies_require_verified
  before insert on public.replies
  for each row execute function public.require_contribution_allowed ();

-- The seeded accounts predate any of this and are not people with inboxes, so
-- mark them verified rather than leaving them one post from being locked.
update public.profiles set verified_at = now() where verified_at is null;
