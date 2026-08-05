import { pngIcon } from '@/lib/brand/pngIcon'

/** The manifest's large icon — the one a launcher and a splash screen use. */
export function GET() {
  return pngIcon(512)
}
