-- Recording that somebody agreed, and to what.
--
-- The terms said "Using it means agreeing to what is below", and nothing on the
-- site had ever mentioned them. That is browsewrap: no notice, no moment of
-- assent, nothing recorded. US courts — and the governing law is now a US state
-- — have thrown browsewrap out repeatedly for exactly that, and the reasoning
-- is not a technicality. Somebody who was never shown the terms did not agree
-- to them, and saying they did on a page they also never saw does not fix it.
--
-- The fix has to survive §6's "there is no form anywhere". So it is sign-in
-- wrap: at the one moment somebody is deliberately creating an account, the
-- prompt says plainly that this means agreeing, names the command that shows
-- them, and waits for an answer that is a positive act. Then this records it.
--
-- Two columns and not one. "They agreed" is nearly useless a year later when
-- the document has changed twice; "they agreed to the 5 August 2026 version" is
-- the thing that can actually be stood behind. Retention follows the account,
-- because a record of consent outliving the account it belongs to would be its
-- own privacy problem.
alter table public.profiles
  add column terms_accepted_at timestamptz,
  add column terms_version     text;

comment on column public.profiles.terms_accepted_at is
  'when this account was created, which is when the terms were agreed to. null for accounts made before there was a moment of assent to record.';

comment on column public.profiles.terms_version is
  'the LAST_UPDATED string of the terms as they stood at that moment.';

-- Deliberately left null for everybody who already exists.
--
-- Backfilling it with now() would be inventing evidence: those accounts were
-- made when nothing asked, and writing a timestamp against them would say they
-- were shown something they were not. Null is the truthful value, and it says
-- exactly which accounts predate the change.

-- Nothing grants a browser the ability to write these. There is no UPDATE grant
-- on `profiles` for `authenticated` at all — that was revoked when the same
-- shape let anybody set their own `verified_at` — and the insert happens in the
-- signup route under the service role. A consent record a user can forge is not
-- a consent record.
--
-- The columns are readable, which is deliberate: it is your own data, and
-- "what did I agree to and when" is a question somebody is entitled to ask.
-- Nothing in the interface shows it for anybody else, and the row-level policy
-- on profiles is unchanged.
