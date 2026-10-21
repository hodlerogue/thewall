import Link from 'next/link'
import { Lost } from '@/components/Lost'

/**
 * Nothing at this address — said with a real 404, and with somewhere to go.
 *
 * QA: `/nope404` answered 200 with a blank page. The status is fixed where the
 * pages call `notFound()`. What a person sees is the prompt, as before, saying
 * what is missing and leaving them somewhere real; the paragraph below is what
 * shows until it boots, and all a crawler or a browser without JavaScript gets.
 */
export default function NotFound() {
  return (
    <Lost>
      <article className="readable">
        <h1>nothing here</h1>
        <p className="readable-gloss">
          There is no room, post or person at this address. It may have been mistyped, or — in
          commons, where nothing lasts more than a day — it may have been here once.
        </p>
        <p className="readable-nav">
          <Link href="/lobby">every room</Link>
        </p>
      </article>
    </Lost>
  )
}
