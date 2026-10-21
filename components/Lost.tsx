'use client'

import { usePathname } from 'next/navigation'
import { Shell } from '@/components/Shell'
import { pathToLocation } from '@/lib/shell/types'

/**
 * The prompt, booted at an address that is not there.
 *
 * The not-found page is handed no params, but the address is still in the bar,
 * and the prompt already knows what to do with a room that does not exist: say
 * "there’s no room called nowhere" and walk you to the lobby. So the 404 keeps
 * that rather than being a dead end with a status code.
 */
export function Lost({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/'
  return <Shell initialLocation={pathToLocation(pathname)}>{children}</Shell>
}
