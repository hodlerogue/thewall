import type { Metadata } from 'next'
import { LegalPage } from '@/app/legal/Document'
import { TERMS } from '@/lib/legal/documents'

export const metadata: Metadata = {
  title: 'terms — thewall.social',
  description: 'What you agree to by using thewall.social.',
}

export default function Page() {
  return <LegalPage document={TERMS} />
}
