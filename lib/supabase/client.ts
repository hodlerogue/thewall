import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser client, holding the anon key.
 *
 * Reading straight from the browser is safe here because the policies decide
 * what is readable, not the caller (§3.9 — reading is anonymous, and every
 * select policy is open). The anon key is meant to be public; the service-role
 * key never leaves the server.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new MissingSupabaseConfig()
  }

  return createBrowserClient(url, key)
}

export function isConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

export class MissingSupabaseConfig extends Error {
  constructor() {
    super(
      'thewall needs a supabase project. copy .env.example to .env.local and fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    )
    this.name = 'MissingSupabaseConfig'
  }
}
