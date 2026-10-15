import type { Location } from '@/lib/shell/types'

/**
 * The feedback form, a third-party widget, shown in the feedback room only.
 *
 * Asked for as a script to embed on "the feedback page":
 *
 *     <script src="https://formaiproject.netlify.app/widget.js"
 *             data-form-id="frm_052cac48" async></script>
 *
 * There is no feedback *page* to paste that into. Every room is one page that
 * swaps its contents without reloading — `go feedback` and `leave` change the
 * address bar and nothing else — so a script pasted into a page would either
 * never load (arriving by `go`) or never leave (walking out). This loads it the
 * first time the feedback room is entered, by any route, and hides what it drew
 * whenever you are anywhere else.
 *
 * What the widget draws is not known here: its code could not be read from the
 * machine this was written on. So nothing below depends on it. Whatever it adds
 * to <body> after being loaded is treated as its own, and that is what gets
 * hidden and shown — the same whether it is a floating button, a panel, or both.
 *
 * Worth knowing: a script on this origin can do anything this site's own code
 * can, including reading the signed-in session, which @supabase/ssr keeps in a
 * cookie a script can see. That is true of every embedded widget on every site
 * that has one, and the reason this one loads in one room and not everywhere.
 */

export const FEEDBACK_ROOM = 'feedback'
export const WIDGET_SRC = 'https://formaiproject.netlify.app/widget.js'
export const WIDGET_FORM_ID = 'frm_052cac48'

const SCRIPT_ID = 'feedback-widget'

/** Whether the widget belongs on screen here: the room, or a post inside it. */
export function wantsWidget(location: Location): boolean {
  return location.room === FEEDBACK_ROOM
}

/** <body>'s children from before the widget was loaded — everything else is its. */
let before: Set<Element> | null = null

/** What each hidden element's own `display` was, so showing it restores exactly that. */
const hiddenDisplay = new WeakMap<HTMLElement, string>()

/**
 * Next.js puts a few elements of its own on <body> — the route announcer for
 * screen readers, and the error overlay while developing. They arrive after the
 * page does, so they would otherwise be taken for the widget's and hidden.
 */
const isFramework = (el: Element) => el.tagName.toLowerCase().startsWith('next')

function widgetElements(doc: Document): HTMLElement[] {
  if (!before) return []
  return Array.from(doc.body.children).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && !before!.has(el) && el.id !== SCRIPT_ID && !isFramework(el),
  )
}

export function showWidget(doc: Document = document): void {
  if (!doc.getElementById(SCRIPT_ID)) {
    before = new Set(Array.from(doc.body.children))
    const script = doc.createElement('script')
    script.id = SCRIPT_ID
    script.src = WIDGET_SRC
    script.async = true
    // The snippet's own attribute, so the widget finds it whether it reads
    // `document.currentScript` or looks for `script[data-form-id]`.
    script.dataset.formId = WIDGET_FORM_ID
    doc.body.appendChild(script)
    return
  }

  for (const el of widgetElements(doc)) {
    if (!hiddenDisplay.has(el)) continue
    const previous = hiddenDisplay.get(el)!
    hiddenDisplay.delete(el)
    if (previous) el.style.setProperty('display', previous)
    else el.style.removeProperty('display')
  }
}

export function hideWidget(doc: Document = document): void {
  for (const el of widgetElements(doc)) {
    if (hiddenDisplay.has(el)) continue
    hiddenDisplay.set(el, el.style.getPropertyValue('display'))
    // `important`, because a widget that shows itself sets `display` inline.
    el.style.setProperty('display', 'none', 'important')
  }
}
