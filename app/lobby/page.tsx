import { connection } from 'next/server'
import { Readable } from '@/components/Readable'
import { Shell } from '@/components/Shell'

/** The lobby: a directory of rooms, and nothing is postable here (§3.10). */
export default async function Page() {
  /*
   * Drawn per visit, never at build time.
   *
   * QA: "/lobby previews a commons post ('nice to be here — ryan, 2h ago') but
   * /commons says 'nothing here yet'." Nothing on this page asked for anything
   * request-specific, so it was prerendered once, at deploy, with the rooms as
   * they were then — and that list is what shows until the prompt finishes
   * loading and replaces it, which on a slow connection is long enough to read,
   * and for a search engine is forever. Commons deletes everything after a day,
   * so the snapshot was advertising posts that no longer existed. Rooms never
   * had this problem: a room's address is a parameter, which already made those
   * pages per-request.
   *
   * `connection()` is how this version of Next says "wait for a real request"
   * — the `dynamic = 'force-dynamic'` page setting is gone from it.
   */
  await connection()

  return (
    <Shell initialLocation={{}}>
      <Readable at={{}} />
    </Shell>
  )
}
