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

    async reply(
      room: string,
      postNo: number,
      body: string,
      toReply?: number,
    ): Promise<number> {
      /*
       * Through `create_reply` rather than an insert, and that is not a
       * refactor — a reply has a number within its post now, and a number has
       * to be allocated somewhere two people answering at the same moment
       * cannot both read the same one. The insert grant is revoked; this is the
       * only door.
       *
       * It also drops a round trip. The old version looked the post up by
       * `(room, post_no)` to find its internal id and then inserted; the
       * function takes the address people actually type and does both.
       */
      const { data, error } = await client.rpc('create_reply', {
        p_room: room,
        p_post_no: postNo,
        p_body: body,
        // Checked by the function rather than trusted, and dropped rather than
        // refused if it names nothing — losing somebody's sentence over a
        // mistyped number is the worse trade.
        p_to_reply: toReply ?? null,
      })

      if (error) throw new Error(friendly(error.message))
      return typeof data === 'number' ? data : 0
    },

    async rename(name: string) {
      // Asked *before* the change, because afterwards the name is yours and the
      // question "was this somebody else's?" answers no.
      const { data: before } = await client.rpc('name_changed_hands', { p_name: name })

      const { error } = await client.rpc('change_name', { p_name: name })
      if (error) return { ok: false as const, reason: friendly(error.message) }

      return {
        ok: true as const,
        name,
        recycled: typeof before === 'string' ? new Date(before) : undefined,
      }
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

    async resend() {
      const response = await fetch('/api/verify/resend', { method: 'POST' })
      const payload = (await response.json().catch(() => ({}))) as { note?: string; error?: string }
      return { note: payload.note ?? payload.error ?? 'couldn’t send just now.' }
    },

    async login(name: string) {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        name?: string
        note?: string
        codeSent?: boolean
        error?: string
      }
      if (!response.ok || !payload.name || !payload.note) {
        return { ok: false as const, reason: payload.error ?? 'couldn’t send a key just now.' }
      }
      return {
        ok: true as const,
        name: payload.name,
        note: payload.note,
        // Defaults to false rather than true. A deployment with no mail
        // provider sends no code, and asking for one that never arrives is a
        // worse dead end than the link-only flow it replaced.
        codeSent: payload.codeSent === true,
      }
    },

    async loginCode(name: string, code: string) {
      const response = await fetch('/api/login/code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, code }),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        name?: string
        error?: string
      }
      if (!response.ok || !payload.name) {
        return { ok: false as const, reason: payload.error ?? 'that code didn’t work.' }
      }
      return { ok: true as const, name: payload.name }
    },

    async logout() {
      const response = await fetch('/api/logout', { method: 'POST' })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        return { ok: false as const, reason: payload.error ?? 'couldn’t sign you out just now.' }
      }
      return { ok: true as const }
    },

    async create(name: string, email: string) {
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email }),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        name?: string
        note?: string
        error?: string
      }
      if (!response.ok || !payload.name) {
        return { ok: false as const, reason: payload.error ?? 'that didn’t work. try again?' }
      }
      // The note says what actually happened to the mail, rather than assuming.
      return { ok: true as const, name: payload.name, note: payload.note }
    },
  }
}

/**
 * Database errors are for logs. What reaches the prompt is a sentence.
 *
 * Exported because the fall-through is "that didn't send. try again?", which is
 * a lie for every refusal the schema makes on purpose — and nothing else would
 * notice a new constraint arriving without a branch here.
 */
export function friendly(message: string): string {
  // §4.7 — the gate. The database says it plainly; this adds the way out.
  if (message.includes('check your email')) {
    return 'check your email to keep saying things — click the link and this is yours. no link? type resend.'
  }
  if (message.includes('posts_body_line_limit') || message.includes('replies_body_line_limit')) {
    return 'that’s a lot of blank lines. say it in fewer.'
  }
  if (message.includes('body_not_blank')) {
    return 'that’s empty — say something.'
  }
  if (message.includes('body_length')) {
    return 'that’s longer than 4000 characters. say it shorter, or say it in two.'
  }
  // The operator's levers, as they land on the person they were pulled at.
  if (message.includes('say things here anymore')) {
    // Passed through rather than replaced: ban() carries the reason, and being
    // told why is the difference between a decision and a wall.
    return message
  }
  // §4.6 — the rename path. `is taken` is the common one and already reads as
  // a sentence, so it is passed through rather than flattened.
  if (message.includes('is taken')) {
    return message
  }
  if (message.includes('a lot of names in an hour')) {
    return 'that’s a lot of names in an hour. give it a while and try again.'
  }
  if (message.includes('already your name')) {
    return 'that’s already your name.'
  }
  if (message.includes('too fast')) {
    return 'that’s a lot of words in a very short time. give it a few minutes and say it again.'
  }
  if (message.includes('no room called')) {
    // A room that vanished mid-sentence — hidden, or never there.
    return 'that room isn’t there. type look to see what is.'
  }
  if (message.includes('commons does not keep threads')) {
    return 'commons doesn’t keep threads — say it as its own thing instead.'
  }
  /*
   * Two the database writes as finished sentences, aimed at the person who hit
   * them. Falling through to "that didn't send. try again?" would replace an
   * explanation with a shrug — and "try again" is advice that cannot work,
   * since both refusals are about what was asked for rather than a failure.
   */
  if (message.includes('somebody else’s wall') || message.includes("somebody else's wall")) {
    return message
  }
  if (message.includes('feed shows what people put on their own walls')) {
    return message
  }
  if (message.includes('signed in')) {
    return 'you have to be signed in to say something.'
  }
  if (message.includes('row-level security')) {
    return 'you can’t write that under someone else’s name.'
  }
  return 'that didn’t send. try again?'
}
