import { pngIcon } from '@/lib/brand/pngIcon'

/** The manifest's small icon. Named as a file so the manifest can point at it. */
export function GET() {
  return pngIcon(192)
}
