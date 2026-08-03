import { suggestAlternates, validateName } from '@/lib/auth/names'
import type { Line, Location } from '@/lib/shell/types'

/**
 * §3.9 — signup is deferred to first contribution.
 *
 * Reading is anonymous. The first `say` is what asks for a name, because
 * friction lands best at peak motivation: someone who has just typed a sentence
 * they want to send is the most willing they will ever be to give you one.
 *
 * The held sentence is the point of the whole design. It is captured before the
 * first question and posted the moment the account exists, so the user never
 * re-types it — and `cancel` at any point returns to reading with nothing lost.
 *
 * This is an input mode, not a page. There is no form anywhere (§6).
 */

export interface Held {
  location: Location
  body: string
}

export interface SignupApi {
  checkName(name: string): Promise<{ available: boolean; alternates: string[] }>
  create(
    name: string,
    email: string,
  ): Promise<{ ok: true; name: string; note?: string } | { ok: false; reason: string }>
  /** Another key. Links expire, so this is part of the rule, not a nicety. */
  resend(): Promise<{ note: string }>
}

export interface Writer {
  /** Returns the new post's permanent address (§3.4). */
  post(room: string, body: string): Promise<number>
  reply(room: string, postNo: number, body: string): Promise<void>
}

type Mode = 'command' | 'ask-name' | 'ask-email'

export interface AnswerResult {
  lines: Line[]
  /** Set when the prompt's identity changed, so the label can follow. */
  identity?: string | null
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class Session {
  private mode: Mode = 'command'
  private held: Held | null = null
  private pendingName: string | null = null
  private who: string | null = null

  constructor(
    private readonly api: SignupApi,
    private readonly writer: Writer,
    /** Set when someone arrives already signed in, through a magic link. */
    existingName: string | null = null,
  ) {
    this.who = existingName
  }

  name(): string | null {
    return this.who
  }

  /** While true, what the user types is an answer, not a command. */
  isAsking(): boolean {
    return this.mode !== 'command'
  }

  /** Called by `say` when there is no account yet. The sentence is kept. */
  begin(held: Held): Line[] {
    this.held = held
    this.mode = 'ask-name'
    return [
      { text: 'one thing first — you need a name to say that under.', tone: 'faint' },
      { text: 'what do you want to be called?', tone: 'accent' },
    ]
  }

  cancel(): Line[] {
    const hadSomething = this.held !== null
    this.mode = 'command'
    this.held = null
    this.pendingName = null
    return [
      {
        text: hadSomething
          ? 'no problem — nothing sent. keep looking around.'
          : 'nothing to cancel.',
        tone: 'faint',
      },
    ]
  }

  async answer(input: string): Promise<AnswerResult> {
    const text = input.trim()

    // §3.9 — cancel at any point, and it costs nothing.
    if (/^(cancel|nevermind|never mind|quit|stop)$/i.test(text)) {
      return { lines: this.cancel() }
    }

    return this.mode === 'ask-name' ? this.answerName(text) : this.answerEmail(text)
  }

  private async answerName(text: string): Promise<AnswerResult> {
    const validated = validateName(text)
    if (!validated.ok) {
      const lines: Line[] = [{ text: validated.reason, tone: 'error' }]
      if (validated.suggestion) {
        lines.push({ text: `${validated.suggestion} would work.`, tone: 'faint' })
      }
      return { lines }
    }

    const { available, alternates } = await this.api.checkName(validated.name)
    if (!available) {
      const lines: Line[] = [{ text: `${validated.name} is taken.`, tone: 'error' }]
      if (alternates.length > 0) {
        lines.push({ text: `${alternates.join(', ')} are free.`, tone: 'faint' })
      }
      return { lines }
    }

    this.pendingName = validated.name
    this.mode = 'ask-email'
    return {
      lines: [
        // No password. A prompt cannot mask input, so there is nothing here to
        // echo to the screen (§3.9, §9).
        { text: 'where should i send your key?', tone: 'accent' },
        { text: 'no password — a link, so you can get back in later.', tone: 'faint' },
      ],
    }
  }

  private async answerEmail(text: string): Promise<AnswerResult> {
    if (!EMAIL.test(text)) {
      return { lines: [{ text: 'that doesn’t look like an email address.', tone: 'error' }] }
    }

    const result = await this.api.create(this.pendingName!, text)
    if (!result.ok) {
      return { lines: [{ text: result.reason, tone: 'error' }] }
    }

    this.who = result.name
    this.mode = 'command'
    this.pendingName = null

    const lines: Line[] = [
      // The source says what actually happened. A demo build has not sent
      // anything, and claiming otherwise to someone who just typed a real
      // address is not a white lie.
      { text: result.note ?? `your key is on its way to ${text}.`, tone: 'faint' },
      { text: '' },
    ]

    // The sentence they typed a minute ago, sent without being asked for again.
    const held = this.held
    this.held = null

    if (held) {
      lines.push({ text: 'now — the thing you were trying to say.', tone: 'accent' })
      lines.push(...(await this.write(held.location, held.body)))
    } else {
      lines.push({ text: `you’re ${result.name} now.`, tone: 'dim' })
    }

    return { lines, identity: this.who }
  }

  /** §4.7 — send another key. Only meaningful once you have an account. */
  async resendKey(): Promise<Line[]> {
    if (this.who === null) {
      return [{ text: 'nothing to send yet — say something first and i’ll ask who you are.', tone: 'error' }]
    }
    const { note } = await this.api.resend()
    return [{ text: note, tone: 'faint' }]
  }

  /** The write path itself, used by `say` and by the held-message commit. */
  async write(location: Location, body: string): Promise<Line[]> {
    if (!location.room) {
      return [{ text: 'you have to be in a room to say something.', tone: 'error' }]
    }

    try {
      if (location.postId !== undefined) {
        await this.writer.reply(location.room, location.postId, body)
        return [{ text: 'said.', tone: 'faint' }]
      }
      const postNo = await this.writer.post(location.room, body)
      return [{ text: `said — it’s post ${postNo}.`, tone: 'faint' }]
    } catch (error) {
      return [
        {
          text: error instanceof Error ? error.message : 'that didn’t send. try again?',
          tone: 'error',
        },
      ]
    }
  }
}
