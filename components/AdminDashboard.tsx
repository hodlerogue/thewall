'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  ACTION_LABEL,
  actionsFor,
  groupForReview,
  hrefFor,
  labelFor,
  type ReviewAction,
  type ReviewItem,
} from '@/lib/support/review'

/**
 * /admin — reports, hidden things, and the threshold.
 *
 * Talks to the database as whoever is signed in, through the same browser
 * client the prompt uses. Every function it calls checks `public.admins` itself
 * (see 20261016000000_reports.sql), so this page decides nothing: somebody who
 * is not an admin can load it and is told so, and could call the functions by
 * hand and be told the same.
 */

type State =
  | { phase: 'loading' }
  | { phase: 'demo' }
  | { phase: 'signed-out' }
  | { phase: 'not-admin' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; items: ReviewItem[]; threshold: number }

export function AdminDashboard({ demo }: { demo: boolean }) {
  const [state, setState] = useState<State>({ phase: demo ? 'demo' : 'loading' })
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [draftThreshold, setDraftThreshold] = useState('')

  const load = useCallback(async () => {
    if (demo) return
    try {
      const client = createClient()
      const { data: session } = await client.auth.getSession()
      if (!session.session) return setState({ phase: 'signed-out' })

      const admin = await client.rpc('is_admin')
      if (admin.error) throw admin.error
      if (!admin.data) return setState({ phase: 'not-admin' })

      const [review, threshold] = await Promise.all([client.rpc('admin_review'), client.rpc('admin_threshold')])
      if (review.error) throw review.error
      if (threshold.error) throw threshold.error

      setState({ phase: 'ready', items: (review.data ?? []) as ReviewItem[], threshold: threshold.data as number })
      // Filled in once, never overwritten: every action reloads this list, and
      // resetting the box on each reload wiped a number somebody was typing —
      // which the save then quietly replaced with the old one.
      setDraftThreshold((typed) => (typed === '' ? String(threshold.data) : typed))
    } catch (error) {
      setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [demo])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (item: ReviewItem, action: ReviewAction) => {
    setBusy(item.target)
    setNotice(null)
    const { error } = await createClient().rpc('admin_resolve', {
      p_room: item.room_slug,
      p_post_no: item.post_no,
      p_reply_no: item.reply_no,
      p_action: action,
    })
    setBusy(null)
    if (error) return setNotice(error.message)
    setNotice(`${labelFor(item)}: ${action === 'restore' ? 'restored' : action === 'hide' ? 'hidden' : 'reports dismissed'}.`)
    await load()
  }

  const saveThreshold = async () => {
    const value = Number(draftThreshold)
    if (!Number.isInteger(value) || value < 1 || value > 100) return setNotice('a whole number from 1 to 100.')
    setBusy('threshold')
    const { error } = await createClient().rpc('admin_threshold', { p_set: value })
    setBusy(null)
    if (error) return setNotice(error.message)
    setNotice(`things are now hidden after ${value} ${value === 1 ? 'report' : 'reports'}.`)
    await load()
  }

  return (
    <main className="admin">
      <h1>thewall · admin</h1>
      <p className="admin-back">
        <Link href="/commons">← back to the prompt</Link>
      </p>

      {state.phase === 'loading' && <p className="admin-quiet">loading…</p>}

      {state.phase === 'demo' && (
        <p>
          This is the demo build, which has no database and nobody to report anything. The dashboard works on the
          real site.
        </p>
      )}

      {state.phase === 'signed-out' && (
        <p>
          Sign in first: go to <Link href="/commons">the prompt</Link>, type <code>login</code> and your name, then come
          back here.
        </p>
      )}

      {state.phase === 'not-admin' && (
        <p>
          This page is for admins, and this account is not one. Admins are added in the database — see
          GOING-LIVE.md, “Reports and the admin dashboard”.
        </p>
      )}

      {state.phase === 'error' && (
        <p role="alert">
          Could not load: {state.message}. If it says a function is missing, the database needs the reports
          migration — run <code>./scripts/db-deploy.sh</code>.
        </p>
      )}

      {notice && (
        <p className="admin-notice" role="status">
          {notice}
        </p>
      )}

      {state.phase === 'ready' && (
        <Review
          items={state.items}
          busy={busy}
          onAct={act}
          threshold={state.threshold}
          draftThreshold={draftThreshold}
          onDraftThreshold={setDraftThreshold}
          onSaveThreshold={saveThreshold}
        />
      )}
    </main>
  )
}

function Review({
  items,
  busy,
  onAct,
  threshold,
  draftThreshold,
  onDraftThreshold,
  onSaveThreshold,
}: {
  items: ReviewItem[]
  busy: string | null
  onAct: (item: ReviewItem, action: ReviewAction) => void
  threshold: number
  draftThreshold: string
  onDraftThreshold: (value: string) => void
  onSaveThreshold: () => void
}) {
  const { waiting, hidden } = groupForReview(items)

  return (
    <>
      <section>
        <h2>
          Reported <span className="admin-count">{waiting.length}</span>
        </h2>
        {waiting.length === 0 ? (
          <p className="admin-quiet">Nothing waiting.</p>
        ) : (
          <ul className="admin-list">
            {waiting.map((item) => (
              <Item key={item.target} item={item} busy={busy} onAct={onAct} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>
          Hidden <span className="admin-count">{hidden.length}</span>
        </h2>
        <p className="admin-quiet">Hidden without open reports — by an admin, or by scripts/moderate.sh.</p>
        {hidden.length === 0 ? (
          <p className="admin-quiet">Nothing hidden.</p>
        ) : (
          <ul className="admin-list">
            {hidden.map((item) => (
              <Item key={item.target} item={item} busy={busy} onAct={onAct} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Threshold</h2>
        <p>
          Something is hidden automatically once <strong>{threshold}</strong> different{' '}
          {threshold === 1 ? 'person reports' : 'people report'} it.
        </p>
        <form
          className="admin-threshold"
          onSubmit={(event) => {
            event.preventDefault()
            onSaveThreshold()
          }}
        >
          <label htmlFor="threshold">Hide after</label>
          <input
            id="threshold"
            type="number"
            min={1}
            max={100}
            value={draftThreshold}
            onChange={(event) => onDraftThreshold(event.target.value)}
          />
          <span>reports</span>
          <button type="submit" disabled={busy !== null}>
            Save
          </button>
        </form>
      </section>
    </>
  )
}

function Item({
  item,
  busy,
  onAct,
}: {
  item: ReviewItem
  busy: string | null
  onAct: (item: ReviewItem, action: ReviewAction) => void
}) {
  return (
    <li className="admin-item">
      <p className="admin-item-head">
        <Link href={hrefFor(item)}>{labelFor(item)}</Link>
        {item.hidden_at ? (
          <span className="admin-badge admin-badge-hidden">hidden</span>
        ) : (
          <span className="admin-badge">visible</span>
        )}
      </p>
      <p className="admin-content">{item.content ?? '(gone)'}</p>
      <p className="admin-meta">
        {item.kind === 'room' ? 'made by' : 'by'} {item.author ?? 'nobody recorded'}
        {item.reports > 0 && (
          <>
            {' · '}
            {item.reports} {item.reports === 1 ? 'report' : 'reports'} from {item.reporters.join(', ')}
          </>
        )}
      </p>
      {item.reasons.length > 0 && (
        <ul className="admin-reasons">
          {item.reasons.map((reason, index) => (
            <li key={index}>“{reason}”</li>
          ))}
        </ul>
      )}
      <p className="admin-actions">
        {actionsFor(item).map((action) => (
          <button key={action} type="button" disabled={busy !== null} onClick={() => onAct(item, action)}>
            {ACTION_LABEL[action]}
          </button>
        ))}
      </p>
    </li>
  )
}
