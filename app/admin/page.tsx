import type { Metadata } from 'next'
import { AdminDashboard } from '@/components/AdminDashboard'

/**
 * Reports, hidden things and the threshold — for admins.
 *
 * Kept out of search results and out of the sitemap. Nothing here is secret
 * (the page decides nothing; the database functions behind it check
 * `public.admins` themselves), but there is no reason for it to be found.
 */
export const metadata: Metadata = {
  title: 'admin · thewall',
  robots: { index: false, follow: false },
}

export default function Page() {
  return <AdminDashboard demo={process.env.NEXT_PUBLIC_USE_FIXTURES === '1'} />
}
