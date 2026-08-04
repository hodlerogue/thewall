import type { Metadata } from 'next'
import { LegalPage } from '@/app/legal/Document'
import { PRIVACY } from '@/lib/legal/documents'

export const metadata: Metadata = {
  title: 'privacy — thewall.social',
  description: 'What thewall.social holds about you, why, and how to have it deleted.',
}

export default function Page() {
  return <LegalPage document={PRIVACY} />
}
