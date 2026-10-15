import { describe, expect, it } from 'vitest'
import { actionsFor, groupForReview, hrefFor, labelFor, type ReviewItem } from '@/lib/support/review'

/** The dashboard's decisions: which buttons, which list, which link. */

const item = (over: Partial<ReviewItem>): ReviewItem => ({
  target: 'music/12',
  kind: 'post',
  room_slug: 'music',
  post_no: 12,
  reply_no: null,
  content: 'words',
  author: 'ryan',
  reports: 0,
  reasons: [],
  reporters: [],
  last_report: null,
  hidden_at: null,
  ...over,
})

describe('which buttons an item gets', () => {
  it('hidden by reports: restore it, or dismiss the reports and leave it hidden', () => {
    expect(actionsFor(item({ reports: 3, hidden_at: '2026-10-16' }))).toEqual(['restore', 'dismiss'])
  })

  it('reported but still visible: hide it, or dismiss — "looked at, it is fine"', () => {
    expect(actionsFor(item({ reports: 1 }))).toEqual(['hide', 'dismiss'])
  })

  it('hidden with no reports, by an admin or by moderate.sh: restore only', () => {
    expect(actionsFor(item({ hidden_at: '2026-10-16' }))).toEqual(['restore'])
  })

  it('never both hide and restore', () => {
    for (const hidden_at of [null, '2026-10-16']) {
      for (const reports of [0, 1, 5]) {
        const actions = actionsFor(item({ hidden_at, reports }))
        expect(actions.includes('hide') && actions.includes('restore')).toBe(false)
      }
    }
  })
})

describe('which list it goes in', () => {
  it('anything with open reports is waiting, hidden or not', () => {
    const items = [
      item({ target: 'a', reports: 3, hidden_at: '2026-10-16' }),
      item({ target: 'b', reports: 1 }),
      item({ target: 'c', hidden_at: '2026-10-16' }),
    ]
    const { waiting, hidden } = groupForReview(items)
    expect(waiting.map((i) => i.target)).toEqual(['a', 'b'])
    expect(hidden.map((i) => i.target)).toEqual(['c'])
  })
})

describe('how it is named and linked', () => {
  it('a room, a post, and a reply — which links to its post', () => {
    const room = item({ kind: 'room', post_no: null, room_slug: 'pulsechain' })
    const reply = item({ kind: 'reply', reply_no: 3 })
    expect([labelFor(room), labelFor(item({})), labelFor(reply)]).toEqual([
      'room pulsechain',
      'music/12',
      'music/12, reply 3',
    ])
    expect([hrefFor(room), hrefFor(item({})), hrefFor(reply)]).toEqual(['/pulsechain', '/music/12', '/music/12'])
  })
})
