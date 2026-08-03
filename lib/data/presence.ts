import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

/**
 * Room presence over a realtime channel, so `who` answers who is actually
 * around rather than who has an account (§6 lists realtime presence in scope).
 *
 * One channel at a time: you are only ever standing in one room, and leaving
 * should take you off its list immediately.
 */
export function createPresence(client: SupabaseClient) {
  let channel: RealtimeChannel | null = null
  let currentRoom: string | null = null
  let identity: string | null = null

  async function leave() {
    if (channel) {
      await client.removeChannel(channel)
      channel = null
      currentRoom = null
    }
  }

  return {
    /** Called whenever location or identity changes. */
    async enter(room: string | undefined, name: string | null) {
      if (room === currentRoom && name === identity) return
      identity = name
      await leave()
      if (!room) return

      currentRoom = room
      channel = client.channel(`room:${room}`, { config: { presence: { key: name ?? anonKey() } } })

      await channel.subscribe(async (status) => {
        if (status !== 'SUBSCRIBED' || !channel) return
        // Guests are counted but not named — `who` says how many are reading
        // without pretending they are people you can address (§3.9).
        await channel.track({ name, guest: name === null })
      })
    },

    /** Names first, then the count of guests reading alongside them. */
    present(): { names: string[]; guests: number } {
      if (!channel) return { names: [], guests: 0 }

      const state = channel.presenceState<{ name: string | null; guest: boolean }>()
      const names = new Set<string>()
      let guests = 0

      for (const entries of Object.values(state)) {
        for (const entry of entries) {
          if (entry.name) names.add(entry.name)
          else guests += 1
        }
      }
      return { names: [...names].sort(), guests }
    },

    leave,
  }
}

export type Presence = ReturnType<typeof createPresence>

function anonKey(): string {
  return `guest-${Math.random().toString(36).slice(2, 10)}`
}
