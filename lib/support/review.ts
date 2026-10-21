/**
 * The dashboard's decisions, kept out of the component so they can be tested.
 *
 * `admin_review()` returns one row per thing that needs looking at: anything
 * with open reports, and anything hidden right now — by reports, by an admin,
 * or by scripts/moderate.sh — so that "restore anything" covers everything
 * hidden, not only what reports hid.
 */

export interface ReviewItem {
  target: string
  kind: 'room' | 'post' | 'reply'
  room_slug: string
  post_no: number | null
  reply_no: number | null
  content: string | null
  author: string | null
  reports: number
  reasons: string[]
  reporters: string[]
  last_report: string | null
  hidden_at: string | null
}

export type ReviewAction = 'restore' | 'hide' | 'dismiss'

/**
 * Which buttons an item gets.
 *
 * Restore for anything hidden; hide for anything visible; dismiss for anything
 * with reports — which closes them and leaves it exactly as it is, the answer
 * for "reported, looked at, fine". Never both restore and hide.
 */
export function actionsFor(item: ReviewItem): ReviewAction[] {
  const actions: ReviewAction[] = [item.hidden_at ? 'restore' : 'hide']
  if (item.reports > 0) actions.push('dismiss')
  return actions
}

/**
 * Split for reading: what is waiting on a decision first, then everything else
 * that is hidden. Something hidden by reports is still waiting — the reports
 * are open until an admin answers them.
 */
export function groupForReview(items: readonly ReviewItem[]) {
  return {
    waiting: items.filter((item) => item.reports > 0),
    hidden: items.filter((item) => item.reports === 0 && item.hidden_at !== null),
  }
}

/** Where to look at it on the site — the post, for a reply. */
export function hrefFor(item: ReviewItem): string {
  return item.post_no === null ? `/${item.room_slug}` : `/${item.room_slug}/${item.post_no}`
}

/** The address the way the prompt writes it. */
export function labelFor(item: ReviewItem): string {
  if (item.kind === 'room') return `room ${item.room_slug}`
  if (item.kind === 'post') return `${item.room_slug}/${item.post_no}`
  return `${item.room_slug}/${item.post_no}, reply ${item.reply_no}`
}

export const ACTION_LABEL: Record<ReviewAction, string> = {
  restore: 'restore',
  hide: 'hide',
  dismiss: 'dismiss reports',
}
