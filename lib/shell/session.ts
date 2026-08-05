import { suggestAlternates, validateName } from '@/lib/auth/names'
import { DOCUMENTS } from '@/lib/legal/documents'
import { formatAgo } from '@/lib/shell/model'
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
  /**
   * Whether the room it is going to keeps addresses.
   *
   * Captured with the sentence rather than worked out when it lands, because
   * the only thing that knows is the command handler that took it — and by the
   * time this is posted, two questions have been asked and answered. Without
   * it the very first thing a new person ever writes, which is usually in
   * commons, came back announcing a post number that means nothing there.
   */
  addressed?: boolean
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
  /**
   * §4.6 — change your name, as often as you like.
   *
   * `recycled` is when the new name was last somebody else's, if it was. It is
   * on the result rather than checked separately because taking a name that
   * has been worn before is a thing worth being told at the moment you take it.
   */
  rename(name: string): Promise<
    { ok: true; name: string; recycled?: Date } | { ok: false; reason: string }
  >
}

type Mode = 'command' | 'ask-name' | 'ask-email'

export interface AnswerResult {
  lines: Line[]
  /** Set when the prompt's identity changed, so the label can follow. */
  identity?: string | null
  /** Set when the held sentence could not be sent, so it is not lost. */
  retry?: string
}

export interface WriteResult {
  lines: Line[]
  /** True when nothing was written, so the caller can hand the words back. */
  failed: boolean
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
        // The name is said back, which it never used to be. The only signal
        // that it had been accepted was the question changing — so a typo in
        // the one word that becomes your identity went by unremarked, and the
        // next thing you were asked for was an address.
        //
        // No password. A prompt cannot mask input, so there is nothing here to
        // echo to the screen (§3.9, §9).
        { text: `${validated.name}, then. where should i send your key?`, tone: 'accent' },
        { text: 'no password — a link, so you can get back in later.', tone: 'faint' },
        // The moment somebody is asked for an address is the moment they are
        // owed a way to read what happens to it. A link in a footer nobody
        // scrolls to is not that; a command they can type right now is.
        {
          text: 'type back to change the name. your address is never shown to anyone — type privacy for what’s kept.',
          tone: 'faint',
        },
        /*
         * The moment of assent, and the only one there is.
         *
         * The terms used to say "using it means agreeing", which nothing on the
         * site had ever mentioned — browsewrap, with no notice and no record.
         * §6 rules out a form and a checkbox, so this is the honest version of
         * the same idea: the sentence sits immediately above the answer that
         * creates the account, it names the command that shows the document,
         * and the answer itself is a deliberate act. `terms_accepted_at` is
         * written server-side on the same statement that makes the account.
         *
         * Accent, not faint. It is the one line here that is a legal
         * consequence rather than a reassurance, and burying it in the quietest
         * colour on the screen would be the footer trick in a different hat.
         */
        {
          text: 'sending it makes an account, and means you agree to the terms — type terms to read them first.',
          tone: 'accent',
        },
      ],
    }
  }

  private async answerEmail(text: string): Promise<AnswerResult> {
    /*
     * One step back, to fix a name you have just watched go past.
     *
     * Until this existed the only exits from here were an email address and
     * `cancel` — and cancel throws the held sentence away, so mistyping your
     * own name cost you the thing §3.9 is built to protect. It is the single
     * most likely typo in the whole product: it is the first thing anybody
     * types, it is a word rather than a sentence, and it is permanent.
     *
     * Deliberately only at this question. `back`, `oops` and `wait` are all
     * perfectly good names, and intercepting a valid name at the name question
     * is exactly the bug that once made people's accounts `look`. An answer
     * here has to be an email address, so nothing spent as a control word here
     * costs anybody a handle.
     */
    if (/^(back|oops|wait|rename|no)$/i.test(text)) {
      const wrong = this.pendingName
      this.pendingName = null
      this.mode = 'ask-name'
      return {
        lines: [
          { text: `no harm done — nothing was made, and ${wrong} is still free.`, tone: 'faint' },
          { text: 'what do you want to be called?', tone: 'accent' },
        ],
      }
    }

    /*
     * Reading the documents, from inside the question that asks you to agree.
     *
     * This question already told people to `type privacy for what's kept`, and
     * that instruction did not work: mid-signup everything typed is an answer,
     * so `privacy` came back as "that doesn't look like an email address". An
     * instruction the product refuses is worse than no instruction, and adding
     * the terms line made it two of them — being told to read something you
     * cannot reach without abandoning what you were doing is the footer trick
     * in a different hat.
     *
     * Safe here for the same reason `back` is, and for no other reason: an
     * answer to this question has to be an email address, so no real answer is
     * being spent. It would not be safe at the name question, where `terms` is
     * a name somebody could want.
     *
     * The question is asked again afterwards, because a document is long and
     * the thing you were in the middle of should not have scrolled away
     * silently.
     */
    const document = DOCUMENTS.find((doc) => doc.title === text.trim().toLowerCase())
    if (document) {
      return {
        lines: [
          ...document.summary.map((line) => ({ text: line, tone: 'faint' as const })),
          { text: '' },
          { text: 'where should i send your key?', tone: 'accent' },
        ],
      }
    }

    if (!EMAIL.test(text)) {
      return {
        lines: [
          { text: 'that doesn’t look like an email address.', tone: 'error' },
          // §3.7 — the error names the way out. Somebody staring at a question
          // they do not want to answer needs to know there is one.
          { text: 'type back to change the name, or cancel to stop.', tone: 'faint' },
        ],
      }
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

    if (!held) {
      lines.push({ text: `you’re ${result.name} now.`, tone: 'dim' })
      return { lines, identity: this.who }
    }

    lines.push({ text: 'now — the thing you were trying to say.', tone: 'accent' })
    const written = await this.write(held.location, held.body, { addressed: held.addressed })
    lines.push(...written.lines)

    // Losing the sentence here would be the worst possible moment for it.
    return { lines, identity: this.who, retry: written.failed ? held.body : undefined }
  }

  /** §4.7 — send another key. Only meaningful once you have an account. */
  async resendKey(): Promise<Line[]> {
    if (this.who === null) {
      return [{ text: 'nothing to send yet — say something first and i’ll ask who you are.', tone: 'error' }]
    }
    const { note } = await this.api.resend()
    return [{ text: note, tone: 'faint' }]
  }

  /**
   * §4.6 — rename, unlimited, and the old name goes back on the shelf.
   *
   * The document leaned one rename ever, with the old name kept reserved so
   * nobody could impersonate. Both halves are decided differently here, and the
   * second is why the success message spends two lines on consequences: posts
   * carry your *current* name, so renaming rewrites attribution on everything
   * you have ever said, and what you release is free the same minute. Someone
   * who does not know that has been surprised rather than served.
   */
  async rename(raw: string): Promise<AnswerResult> {
    if (this.who === null) {
      return {
        lines: [
          { text: 'you don’t have a name yet.', tone: 'error' },
          { text: 'say something and i’ll ask you for one.', tone: 'faint' },
        ],
      }
    }

    const validated = validateName(raw)
    if (!validated.ok) {
      const lines: Line[] = [{ text: validated.reason, tone: 'error' }]
      if (validated.suggestion) lines.push({ text: `${validated.suggestion} would work.`, tone: 'faint' })
      return { lines }
    }

    if (validated.name === this.who) {
      return { lines: [{ text: `you’re already ${this.who}.`, tone: 'faint' }] }
    }

    const previous = this.who
    const result = await this.writer.rename(validated.name)
    if (!result.ok) {
      return { lines: [{ text: result.reason, tone: 'error' }] }
    }

    this.who = result.name
    const lines: Line[] = [
      { text: `you’re ${result.name} now.`, tone: 'accent' },
      { text: `everything you’ve said says ${result.name} too — it follows you.`, tone: 'faint' },
      { text: `${previous} is free for anyone to take.`, tone: 'faint' },
    ]
    if (result.recycled) {
      lines.push({
        text: `and ${result.name} was somebody else’s until ${formatAgo(result.recycled)}.`,
        tone: 'faint',
      })
    }
    return { lines, identity: result.name }
  }

  /** The write path itself, used by `say` and by the held-message commit. */
  async write(
    location: Location,
    body: string,
    /**
     * Whether the room keeps what is said in it.
     *
     * Passed in rather than looked up: the caller is the command handler, which
     * already knows — `commons` is its own context precisely because §3.10
     * makes it a different kind of place.
     */
    options: { addressed?: boolean } = {},
  ): Promise<WriteResult> {
    if (!location.room) {
      return {
        lines: [{ text: 'you have to be in a room to say something.', tone: 'error' }],
        failed: true,
      }
    }

    try {
      if (location.postId !== undefined) {
        await this.writer.reply(location.room, location.postId, body)
        return { lines: [{ text: 'said.', tone: 'faint' }], failed: false }
      }
      const postNo = await this.writer.post(location.room, body)

      /*
       * Commons gets a number from the allocator like everywhere else, and it
       * means nothing there: §3.10 keeps no threads, `go 26` in commons answers
       * "there's nothing to open here", and the post is gone in a day. Saying
       * "it's post 26" anyway was an invitation to look for a number that is
       * not shown next to anything and cannot be used — which is exactly the
       * question it produced.
       */
      if (options.addressed === false) {
        return { lines: [{ text: 'said.', tone: 'faint' }], failed: false }
      }

      return {
        lines: [
          { text: `said — it’s post ${postNo}.`, tone: 'faint' },
          // What the number is *for*. On its own it reads as a receipt; the
          // point of it is that it is the address replies arrive at, and that
          // it is the same number in the URL (§3.4).
          { text: `go ${postNo} opens it, which is where replies land.`, tone: 'faint' },
        ],
        failed: false,
      }
    } catch (error) {
      return {
        lines: [
          {
            text: error instanceof Error ? error.message : 'that didn’t send. try again?',
            tone: 'error',
          },
        ],
        failed: true,
      }
    }
  }
}
