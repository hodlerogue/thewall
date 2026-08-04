import { supabaseEnv } from '@/lib/data/supabaseEnv'
import { fixtureEnv, type Env } from '@/lib/shell/env'
import { createReaderClient } from '@/lib/supabase/reader'

/**
 * Where a share card reads from.
 *
 * The same rule the shell follows in `Shell.tsx`, and for the same reason: a
 * demo deploy serves fixtures everywhere, so a card that reached past them
 * would advertise content that deployment does not have. There is no silent
 * fallback in the other direction — a configured project that fails to answer
 * gets the generic card, never invented posts.
 */
export function ogEnv(): Env | null {
  if (process.env.NEXT_PUBLIC_USE_FIXTURES === '1') return fixtureEnv()
  const client = createReaderClient()
  return client ? supabaseEnv(client) : null
}
