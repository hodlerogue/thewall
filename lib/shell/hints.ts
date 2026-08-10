import type { Line } from '@/lib/shell/types'

/**
 * The little instructions, and a way to stop being given them.
 *
 * "Not sure people want to be constantly given instructions. There should be a
 * setting that allows you to turn that off for sure."
 *
 * Right, and the tension is real rather than an oversight: §3.6 says the
 * interface has to teach itself, because somebody who has never opened a
 * terminal cannot be handed a blank prompt. That argument is about the first
 * ten minutes. The same line on the four hundredth `look` is not teaching
 * anybody anything — it is the site talking over the conversation, in a room
 * whose whole point is the conversation.
 *
 * So the lines stay and become switchable, defaulting to on: somebody who has
 * not learned the site yet cannot know to ask for help, and somebody who has
 * can type four characters.
 *
 * **What counts as a hint** is the part worth getting right, and it is one
 * rule: a hint teaches a command you could type next. A line that reports
 * something you cannot otherwise see is not a hint, however instructional it
 * sounds — `older — the page before this one` and `4 more rooms` are the site
 * admitting it is showing you a slice, and silencing those brings back the
 * silent truncation they were written to end. Errors are never hints either:
 * an error is the answer to something you just did.
 */

export const HINTS_KEY = 'thewall.hints'

/**
 * Read every time rather than cached.
 *
 * A module-level cache would be one more copy of a fact that lives in
 * `localStorage`, and the two would disagree the first time a second tab
 * changed it. This is a synchronous read of a short string on a path that
 * already renders a page.
 */
export function hintsOn(): boolean {
  if (typeof localStorage === 'undefined') return true
  try {
    return localStorage.getItem(HINTS_KEY) !== 'off'
  } catch {
    // Private browsing, or storage disabled. Hints are the safe default —
    // being shown a line you did not want beats a prompt that explains nothing.
    return true
  }
}

export function setHints(on: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (on) localStorage.removeItem(HINTS_KEY)
    else localStorage.setItem(HINTS_KEY, 'off')
  } catch {
    // The choice holds for this session and will not be remembered, which is
    // not worth a message the person did not ask for.
  }
}

/**
 * Everything except the teaching, when the teaching is switched off.
 *
 * Applied where lines enter the scrollback rather than where they are built, so
 * it catches the boot lines and anything arriving live as well — and so no
 * renderer has to know the setting exists.
 */
export function withoutHints(lines: readonly Line[], on = hintsOn()): Line[] {
  if (on) return [...lines]

  const kept = lines.filter((line) => !line.hint)

  /*
   * A blank line whose only neighbours were hints is a hint too.
   *
   * Not cosmetic: the renderers use an empty line to separate a listing from
   * the instruction under it, and dropping the instruction alone leaves a room
   * ending in two blank lines and a gap where nothing was said. Only trailing
   * ones, because a gap in the middle of a listing is part of the listing.
   */
  while (kept.length > 0 && kept[kept.length - 1].text === '') kept.pop()
  return kept
}
