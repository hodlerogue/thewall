/**
 * Addresses that provably cannot receive mail, and must never be sent to.
 *
 * Not a spam filter and not an opinion about who deserves email. These are the
 * domains the standards reserve so that they can never resolve — RFC 2606 and
 * RFC 6761 set aside `.test`, `.example`, `.invalid` and `.localhost`, plus
 * `example.com/net/org`, precisely so documentation and fixtures have somewhere
 * safe to point. There is no DNS behind them and there never will be, so a
 * message addressed to one is a **hard bounce**, every time.
 *
 * Hard bounces are the thing that gets a sending domain throttled or cut off,
 * and they cost most on a domain that has just been warmed — which is the state
 * this one is in. One bounce is nothing; a steady trickle is a suspended
 * account and no sign-in keys for anybody.
 *
 * Where the trickle comes from is the part worth writing down, because it is
 * not hypothetical and it is not user error:
 *
 *   * `supabase/seed.sql` creates five accounts at `@seed.invalid` so the
 *     seeded posts have authors. They are verified, they hold posts sitting in
 *     the lobby, and the daily digest is on by default — so the first time a
 *     real person answers jameson, the job tries to email `jameson@seed.invalid`
 *     and keeps trying every day there is something new.
 *   * Those five names are printed on the site and written in a public
 *     repository, so `login jameson` is a thing anyone can type, and each one
 *     is another bounce.
 *
 * Both were live. `pending_digests` filters these out in SQL for the same
 * reason, so the rule holds whether the send is decided in a route or in a
 * cron job — see 20260809000000_no_mail_to_nowhere.sql.
 */

/** RFC 2606 §2 and RFC 6761 — reserved for documentation and testing. */
const RESERVED_TLDS = ['.test', '.example', '.invalid', '.localhost']

/** RFC 2606 §3 — the second-level names reserved alongside them. */
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org']

export function canReceiveMail(address: string): boolean {
  const at = address.lastIndexOf('@')
  if (at === -1) return false

  const domain = address.slice(at + 1).trim().toLowerCase()
  if (domain === '') return false

  // The domain itself, and anything under it. `mail.example.com` is the shape
  // people actually type into a signup box when they are trying something out,
  // and it bounces exactly as hard as the bare name. The SQL half of this rule
  // matches on `(@|\.)example\.com$` for the same reason.
  if (RESERVED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return false
  // `endsWith` rather than a split on the last dot: `.example` is a whole TLD
  // and `foo.example.com` is a subdomain of a reserved *domain*, and both have
  // to be caught by something.
  return !RESERVED_TLDS.some((tld) => domain === tld.slice(1) || domain.endsWith(tld))
}
