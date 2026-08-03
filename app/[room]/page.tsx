import { Shell } from '@/components/Shell'

/** `thewall.sh/music` — the same place `go music` puts you (§3.4). */
export default async function Page({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params
  return <Shell initialLocation={{ room }} />
}
