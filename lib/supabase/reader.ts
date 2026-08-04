import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * An anonymous, session-less client for reading on the server.
 *
 * The browser client is built on `@supabase/ssr` and wants cookies; the route
 * client reads the caller's session. Neither fits a share card, which is
 * rendered for whichever crawler asked and has no session, no cookies and
 * nobody to be. This is the anon key and the select policies, which is exactly
 * §3.9's posture — reading is anonymous — expressed on the server.
 *
 * Returns null rather than throwing when the project is not configured, since
 * every caller here has to produce an image either way.
 */
export function createReaderClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
