import { redirect } from 'next/navigation'

/**
 * The front door.
 *
 * §3.10 — you start in commons. It is a peer room rather than special
 * structure, so the front door simply puts you in it; the lobby has its own
 * address at /lobby and stays a pure directory, one `leave` away.
 */
export default function Page() {
  redirect('/commons')
}
