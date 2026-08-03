import type { SupabaseClient } from '@supabase/supabase-js'
import type { SignupApi, Writer } from '@/lib/shell/session'

/**
 * The write half of the data layer.
 *
 * Posting goes through the `create_post` RPC rather than an insert, because the
 * post's address is the database's to allocate, never the client's (§3.4).
 */
export function supabaseWriter(client: SupabaseClient): Writer {
  return {
    async post(room: string, body: string): Promise<number> {
      const { data, error } = await client.rpc('create_post', { p_room: room, p_body: body })
      if (error) throw new Error(friendly(error.message))
      const row = Array.isArray(data) ? data[0] : data
      return row.post_no
    },

    async reply(room: string, postNo: number, body: string): Promise<void> {
      const {
        data: { user },
      } = await client.auth.getUser()
      if (!user) throw new Error('you’re not signed in anymore. say it again to sign back in.')

      // post_no is the address a person types; replies hang off the internal id.
      const { data: post, error: findError } = await client
        .from('posts')
        .select('id')
        .eq('room_slug', room)
        .eq('post_no', postNo)
        .maybeSingle()

      if (findError) throw new Error(friendly(findError.message))
      if (!post) throw new Error(`post ${postNo} isn’t there anymore.`)

      const { error } = await client
        .from('replies')
        .insert({ post_id: post.id, author_id: user.id, body })

      if (error) throw new Error(friendly(error.message))
    },
  }
}

/** Talks to the prompt's signup route (§3.9). */
export function httpSignupApi(): SignupApi {
  return {
    async checkName(name: string) {
      const response = await fetch(`/api/signup?name=${encodeURIComponent(name)}`)
      if (!response.ok) return { available: false, alternates: [] }
      return (await response.json()) as { available: boolean; alternates: string[] }
    },

    async create(name: string, email: string) {
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email }),
      })

      const payload = (await response.json().catch(() => ({}))) as { name?: string; error?: string }
      if (!response.ok || !payload.name) {
        return { ok: false as const, reason: payload.error ?? 'that didn’t work. try again?' }
      }
      return { ok: true as const, name: payload.name }
    },
  }
}

/** Database errors are for logs. What reaches the prompt is a sentence. */
function friendly(message: string): string {
  if (message.includes('commons does not keep threads')) {
    return 'commons doesn’t keep threads — say it as its own thing instead.'
  }
  if (message.includes('signed in')) {
    return 'you have to be signed in to say something.'
  }
  if (message.includes('row-level security')) {
    return 'you can’t write that under someone else’s name.'
  }
  return 'that didn’t send. try again?'
}
