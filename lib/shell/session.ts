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
  /**
   * Which reply this was aimed at, when it was aimed at one.
   *
   * Held with the sentence for the same reason the sentence is held at all: two
   * questions happen between typing `reply 2 <something>` and it landing, and
   * dropping the number over that gap would turn answering somebody into
   * answering the post — silently, at the one moment §3.9 promises nothing
   * typed is lost.
   */
  toReply?: number
  /**
   * Whether it is going somewhere the person is not standing.
   *
   * `reply music/12 <something>` can be typed from anywhere, so the address is
   * not in the prompt and the confirmation is the only place it appears. Held
   * with the sentence for the same reason `toReply` is: two questions happen in
   * between, and by the time it lands the location that started it is gone.
   */
  elsewhere?: boolean
  /**
   * Send it to the wall of whoever this turns out to be.
   *
   * `location` cannot say that yet. Somebody typing on the feed with no account
   * has no name, so there is no `~name` to write down — and by the time there
   * is, two questions have been asked and the location that started this is
   * long gone. So the intent is recorded and the address resolved at commit.
   */
  toOwnWall?: boolean
}

export interface SignupApi {
  checkName(name: string): Promise<{ available: boolean; alternates: string[] }>
  create(
    name: string,
    email: string,
  ): Promise<{ ok: true; name: string; note?: string } | { ok: false; reason: string }>
  /** Another key. Links expire, so this is part of the rule, not a nicety. */
  resend(): Promise<{ note: string }>
  /**
   * A key for an account that already exists, addressed by name.
   *
   * Separate from `resend` because they solve opposite problems: `resend` needs
   * a session and re-sends to the address on it, and this one exists precisely
   * for the case where there is no session to read an address off.
   */
  login(
    name: string,
  ): Promise<
    { ok: true; name: string; note: string; codeSent?: boolean } | { ok: false; reason: string }
  >
  /**
   * The other half of `login`: the short key, typed rather than followed.
   *
   * Exists because a link cannot sign you in where you are. A mail app opens
   * links in a browser it owns, with its own cookies, so the key is spent over
   * there and the browser you were reading in never gets a session. The code
   * is read with the eyes and typed here, so the session lands in this browser
   * — which is the one that asked.
   */
  loginCode(
    name: string,
    code: string,
  ): Promise<{ ok: true; name: string } | { ok: false; reason: string }>
  /** Ends the session on this device. Nothing anywhere else changes. */
  logout(): Promise<{ ok: true } | { ok: false; reason: string }>
}

export interface Writer {
  /** Returns the new post's permanent address (§3.4). */
  post(room: string, body: string): Promise<number>
  /**
   * Returns the reply's number within the post (§3.4, one level down).
   *
   * `toReply` is which reply is being answered, when one is. It is a pointer
   * for reading rather than a parent in a tree — see the migration — and the
   * database drops it rather than refusing if it names nothing.
   */
  reply(room: string, postNo: number, body: string, toReply?: number): Promise<number>
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

type Mode = 'command' | 'ask-name' | 'ask-email' | 'ask-one' | 'writing'

/**
 * A single question the prompt is waiting on, and what to do with the answer.
 *
 * §6 rules out forms, and the prompt already knows how to ask things — that is
 * the whole of signup. So anything that needs one more piece of information
 * asks for it here rather than demanding it be typed on the same line as the
 * command, which is how `make onions` came back as an error telling somebody to
 * retype what they had just typed with more on the end.
 *
 * The handler keeps its own closure, so this stays ignorant of Env: it knows
 * how to ask and how to hand the answer back, and nothing about rooms.
 */
interface OneQuestion {
  /**
   * `identity` is here because an answered question can now sign somebody in.
   *
   * It was `{ lines, location }` while the only thing `askOne` did was name a
   * room, and the ask-one branch of `answer()` copied exactly those two fields
   * across — so a third would have been dropped on the floor with nothing
   * saying so. That branch forwards the whole result now.
   */
  answer: (
    text: string,
  ) => Promise<{ lines: Line[]; location?: Location; identity?: string | null }>
  /**
   * Kept so an empty answer can re-ask the actual question.
   *
   * It used to substitute one fixed line — "still waiting, say it in a few
   * words" — which was written for the only caller there was, the room gloss.
   * Told to somebody who has just been asked for a six-character code, "in a
   * few words" is advice for a different question entirely.
   */
  question: readonly Line[]
}

export interface AnswerResult {
  lines: Line[]
  /** Set when the prompt's identity changed, so the label can follow. */
  identity?: string | null
  /** Set when the held sentence could not be sent, so it is not lost. */
  retry?: string
  /**
   * Set when answering moved you.
   *
   * Answering `what is onions for?` opens the room and walks you into it, and
   * without this the lines said "you are in it" while the prompt still said
   * `poker` — the answer path had no way to report a move because until now no
   * answer caused one.
   */
  location?: Location
  /** Set when the sentence held across signup turned out to be a reply. */
  answered?: { room: string; postId: number }
}

export interface WriteResult {
  lines: Line[]
  /** True when nothing was written, so the caller can hand the words back. */
  failed: boolean
  /** The post an answer landed on, when it was one. See `Line.counts`. */
  answered?: { room: string; postId: number }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The held sentence, spelled as the command that would send it.
 *
 * `retry` puts text in the prompt, and the prompt runs what is in it — so the
 * words alone are not enough. The verb depends on where it was going and the
 * aim has to survive with it, or a failed reply comes back as a line that would
 * post somewhere else entirely if it were run.
 */
function retryLine(target: Location, held: Held): string {
  if (target.postId === undefined) return `say ${held.body}`
  const aim = held.elsewhere
    ? `${target.room}/${target.postId} `
    : held.toReply === undefined
      ? ''
      : `${held.toReply} `
  return `reply ${aim}${held.body}`
}

export class Session {
  private mode: Mode = 'command'
  private held: Held | null = null
  private pendingName: string | null = null
  private pending: OneQuestion | null = null
  /** The post being written, while one is. See `compose`. */
  private draft: { location: Location; addressed: boolean; lines: string[] } | null = null
  private who: string | null = null
  /**
   * Whether "what the post number is for" has been said yet in this sitting.
   *
   * Deliberately not persisted. A reload is a new sitting and costs one extra
   * line; a `localStorage` key would be a second place the answer to "have they
   * seen this" lives, and the cheaper wrong answer is the one that repeats.
   */
  private explainedAddresses = false

  /**
   * How far back through a room you have walked, as the oldest address shown.
   *
   * Held here rather than threaded through `Location` — a page position is not
   * part of an address, and putting it in one would put it in the URL, where
   * §3.4 says the path and the prompt are the same value.
   *
   * `null` means "you are looking at the newest page", which is true after
   * arriving, after `look`, and after `go`. `older` is the only thing that
   * moves it, and it resets whenever a fresh listing is printed — otherwise
   * typing `look` to get your bearings would leave `older` continuing from
   * wherever you had wandered to, which is not where you are looking.
   */
  private paging: { room: string; oldest: number } | null = null

  /** Where `older` should continue from, or null if it has to work it out. */
  pagedFrom(room: string): number | null {
    return this.paging && this.paging.room === room ? this.paging.oldest : null
  }

  /** Called by `older` once it knows what it just printed. */
  paged(room: string, oldest: number): void {
    this.paging = { room, oldest }
  }

  /** Called wherever a fresh listing is printed, which is the newest page. */
  resetPaging(): void {
    this.paging = null
  }

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

  /**
   * Ask one thing, then hand the answer to whoever asked.
   *
   * `question` is what the prompt shows; `answer` receives what was typed and
   * returns the lines to print. Nothing is validated here — the caller knows
   * what a good answer looks like and this does not.
   */
  askOne(question: readonly Line[], answer: OneQuestion['answer']): Line[] {
    this.mode = 'ask-one'
    this.pending = { answer, question }
    return [...question]
  }

  cancel(): Line[] {
    /*
     * "Nothing sent" is about the held sentence, and it stopped being true of
     * every branch the moment a question could follow something that *was*
     * sent. Cancelling the code question leaves a real key sitting in a real
     * inbox; telling that person nothing was sent is a small lie on a path they
     * are already confused enough to be walking.
     */
    const held = this.held !== null
    const writing = this.draft !== null
    const asking = held || writing || this.pending !== null || this.pendingName !== null
    this.mode = 'command'
    this.held = null
    this.pendingName = null
    this.pending = null
    this.draft = null

    if (!asking) return [{ text: 'nothing to cancel.', tone: 'faint' }]
    return [
      {
        text: writing
          ? // Said plainly, because this one throws away work rather than a
            // single sentence, and somebody who typed it by accident deserves
            // to know exactly what just happened.
            'thrown away. nothing was posted.'
          : held
            ? 'no problem — nothing sent. keep looking around.'
            : 'no problem. keep looking around.',
        tone: 'faint',
      },
    ]
  }

  /**
   * The longest a body may be, stated once on this side of the wire.
   *
   * The database says the same number in a check constraint and
   * `lib/data/writer.test.ts` reads that file to make sure the two agree — a
   * limit that disagrees with the one enforcing it is how a long piece of
   * writing gets accepted by the prompt and refused by the server, which is the
   * one moment §3.9 promises cannot happen.
   */
  static readonly LIMIT = 4000

  /**
   * Start a longer post: lines, until a line with just a dot on it.
   *
   * The prompt is a single-line `<input>`, so until now a body could be
   * thousands of characters and had to be one unbroken block — there was no
   * way to type a line break, and pasting one in flattens it. That is the
   * whole of what was missing; the length cap was never the thing in the way.
   *
   * A dot on its own line is the `mail(1)` and `ed(1)` convention, which is
   * both the oldest answer to this problem and the one a terminal-literate
   * visitor guesses first (§3.5). It is also the only line it could be: a
   * blank line has to stay meaningful, because a blank line is what a
   * paragraph break *is*.
   */
  compose(location: Location, addressed: boolean): Line[] {
    this.mode = 'writing'
    this.draft = { location, addressed, lines: [] }
    return [
      { text: 'writing. a line with just a dot on it ends the post.', tone: 'accent' },
      { text: 'blank lines are paragraph breaks. cancel throws it away.', tone: 'faint' },
    ]
  }

  /**
   * How much has been written, for the line above the prompt.
   *
   * Null when nothing is being written, which is what lets the caller show the
   * indicator without asking a second question. It exists because compose mode
   * is the one state where forgetting you are in it is expensive: every line
   * you type is swallowed into a draft, and unlike the signup questions there
   * is nothing being asked to remind you.
   */
  composing(): { lines: number; chars: number } | null {
    if (this.draft === null) return null
    return { lines: this.draft.lines.length, chars: this.draftLength() }
  }

  private draftLength(): number {
    return this.draft === null ? 0 : this.draft.lines.join('\n').length
  }

  async answer(input: string): Promise<AnswerResult> {
    /*
     * Writing is handled before anything else, and on the *raw* line.
     *
     * Trimming would eat the indentation somebody typed on purpose, and the
     * generic escapes below would eat their prose: `login ryan` is a plausible
     * sentence in the middle of a paragraph, and treating it as a command would
     * throw away everything written so far. In here only two lines mean
     * anything other than themselves — a dot, and cancel.
     */
    if (this.mode === 'writing' && this.draft !== null) {
      const line = input.replace(/\s+$/, '')

      if (/^(cancel|nevermind|never mind|quit|stop)$/i.test(line.trim())) {
        return { lines: this.cancel() }
      }

      if (line.trim() === '.') {
        const draft = this.draft
        // Trailing blank lines are what you get from pressing enter twice before
        // the dot, and they are never meant.
        const body = draft.lines.join('\n').replace(/\n+$/, '').trim()
        this.draft = null
        this.mode = 'command'

        if (body === '') {
          return { lines: [{ text: 'nothing written — nothing sent.', tone: 'faint' }] }
        }

        // §3.9 — the same held-sentence path a one-line `say` takes. A whole
        // draft is a sentence as far as this is concerned, and losing one to a
        // signup question would be the worst version of the bug that machinery
        // exists to prevent.
        if (this.who === null) {
          return {
            lines: this.begin({ location: draft.location, body, addressed: draft.addressed }),
          }
        }

        const written = await this.write(draft.location, body, { addressed: draft.addressed })

        /*
         * A draft that did not send stays a draft.
         *
         * It used to come back through `retry`, which puts text in the prompt —
         * and the prompt is a single-line `<input>`, which strips newlines on
         * assignment. So a failed post came back with every paragraph break
         * gone: the one thing `write` exists to make possible, destroyed by the
         * mechanism meant to protect it.
         *
         * Holding the draft instead costs nothing and loses nothing. The mode
         * stays on, the indicator stays on, and a second dot tries again.
         */
        if (written.failed) {
          this.draft = draft
          this.mode = 'writing'
          return {
            lines: [...written.lines, { text: 'still here — type a dot to try again.', tone: 'faint' }],
          }
        }
        return { lines: written.lines, answered: written.answered }
      }

      /*
       * Refused a line at a time, never the whole draft.
       *
       * The database would refuse the commit, and by then the draft is gone and
       * so is the writing. Checking here means the answer arrives while there
       * is still something to shorten, and the line that would not fit is
       * handed straight back rather than swallowed.
       */
      const would = this.draftLength() + (this.draft.lines.length > 0 ? 1 : 0) + line.length
      if (would > Session.LIMIT) {
        return {
          lines: [
            {
              text: `that would take it past ${Session.LIMIT} characters, which is the limit.`,
              tone: 'error',
            },
            { text: 'end it with a dot, or shorten that line and try again.', tone: 'faint' },
          ],
          retry: line,
        }
      }

      this.draft.lines.push(line)
      // Nothing printed. The echo above is the record of what was typed, and a
      // word under every line is how a prompt turns into a chat client.
      return { lines: [] }
    }

    const text = input.trim()

    // §3.9 — cancel at any point, and it costs nothing.
    if (/^(cancel|nevermind|never mind|quit|stop)$/i.test(text)) {
      return { lines: this.cancel() }
    }

    /*
     * `login ryan`, mid-question, because that is what the site just told them
     * to type.
     *
     * The trap this closes, in full: somebody comes back on a new phone, says
     * something, is asked what to call them, and answers with their own name.
     * They are told "ryan is taken. if it's taken by you, type login ryan."
     * They type it — and mid-signup everything typed is an answer, so it went
     * to the name check, which rejected `login ryan` for having a space and
     * helpfully offered them `login_ryan`. The one instruction on screen could
     * not be followed, and the suggestion on offer was a third wrong account.
     *
     * That is CHANGING-IT's own rule — a suggested fix has to be one the site
     * will accept — broken one commit after writing it down, in the message
     * added to fix the previous version of the same trap.
     *
     * Only the two-word form. A bare `login` is a perfectly good name and has
     * to stay answerable as one; `login ryan` cannot be a name at all, because
     * names have no spaces, so there is nothing to be ambiguous about.
     *
     * It cancels first, exactly as typing `cancel` then `login ryan` would —
     * the held sentence goes, and `cancel` says so.
     */
    const escape = /^login\s+(\S+)$/i.exec(text)
    if (escape) {
      const cancelled = this.cancel()
      return { lines: [...cancelled, ...(await this.signIn(escape[1]))] }
    }

    if (this.mode === 'ask-one') {
      const pending = this.pending
      this.pending = null
      this.mode = 'command'
      if (!pending) return { lines: [] }
      if (text === '') {
        // An empty answer is not an answer, and dropping back to the command
        // prompt would leave somebody wondering what happened to their room.
        // The question comes back in full rather than a stand-in sentence —
        // whatever was worth asking is worth asking the same way twice.
        return {
          lines: this.askOne(
            [{ text: 'still waiting.', tone: 'faint' }, ...pending.question],
            pending.answer,
          ),
        }
      }
      return await pending.answer(text)
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
      /*
       * "Taken" is the right answer for a stranger and the wrong one for the
       * person it is taken *by* — and the second is a large share of the people
       * who ever see this line. Somebody on a new phone, told to say something
       * to get back in, is asked for a name and gives their own; what came back
       * was `ryan is taken. ryan2, ryan_ are free.` The site's answer to "I
       * already have an account" was an invitation to make another one, and
       * whoever accepted it lost their old name's history for good.
       *
       * So the way back is offered before the alternates, because for that
       * reader the alternates are not options at all.
       */
      const lines: Line[] = [
        { text: `${validated.name} is taken.`, tone: 'error' },
        { text: `if it’s taken by you, type login ${validated.name}.`, tone: 'faint' },
      ]
      if (alternates.length > 0) {
        lines.push({ text: `otherwise ${alternates.join(', ')} are free.`, tone: 'faint' })
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
         * Said here because this is the moment the address changes hands, and
         * the daily summary is on from the moment the account exists.
         *
         * An opt-out somebody has to discover is a worse thing than an opt-in.
         * An opt-out they were told about, in the sentence where they handed
         * over the address, at the same volume as everything else — that is a
         * default rather than a trick, and the difference is one line.
         */
        {
          text: 'i’ll email you when somebody answers you, once a day at most. notify off stops that.',
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
      /*
       * What the name means, and what it does not, said at the one moment it
       * could be taken for more than it is.
       *
       * The prompt stops saying `guest` here and starts saying your name, and
       * that was read as "it looks like you're logged in" — reported as
       * misleading, because the address has not been proven yet.
       *
       * You *are* signed in: the session is real, it is why the held sentence
       * could post at all, and taking the name back out of the prompt would
       * make it disagree with the post sitting in the room under that same
       * name. §3.9's whole design is that the name is yours the moment you pick
       * it. So the fix is not to hide it — it is to stop leaving the other half
       * unsaid until the gate closes on somebody two sentences later with
       * "check your email to keep saying things".
       */
      /*
       * ...but only where there *is* a key. A note means something other than a
       * normal send happened, and in the demo the note is "nothing was sent —
       * this is a demo, and your address wasn't kept."
       *
       * Saying "follow that key" under that line pointed at a key the line
       * above had just said did not exist, and "i'll ask for it before the next
       * thing you say" was a promise the demo then broke: the next `say` goes
       * straight through, because there is nothing to verify against. Found by
       * walking the demo rather than by a test — both lines are mine, from the
       * fix for the prompt reading as "logged in", and neither had any business
       * being said where no key was sent.
       */
      ...(result.note === undefined
        ? [
            {
              text: `you’re ${result.name} here now. the address isn’t proven until you follow that key —`,
              tone: 'faint' as const,
            },
            { text: 'i’ll ask for it before the next thing you say.', tone: 'faint' as const },
          ]
        : [{ text: `you’re ${result.name} here now.`, tone: 'faint' as const }]),
      { text: '' },
    ]

    // The sentence they typed a minute ago, sent without being asked for again.
    const held = this.held
    this.held = null

    // Nothing was being held — `cancel` empties it, so this is reachable. The
    // two lines above have already said who they are, which is what the line
    // that used to be here said less completely.
    if (!held) return { lines, identity: this.who }

    /*
     * A heading, and now it has something to head.
     *
     * It said "now — the thing you were trying to say." once, and was rewritten
     * into the past tense because nothing followed it: in commons and in a post
     * the write printed no line at all, so the last thing on screen was a
     * sentence promising something and then blank.
     *
     * Rewriting the promise was treating the symptom. What was actually missing
     * is the post — "nowhere do i see the thing i was trying to say. I have to
     * type look to see it." Signing up takes four or five lines, and the words
     * scroll out of reach behind them; every other time you say something they
     * are on the line directly above, which is the whole reason this function
     * prints an address rather than a transcript. So `echoed: false` below, and
     * this can be a heading again.
     */
    // The wall is named here, because here is the first moment there is a name.
    const target = held.toOwnWall ? { room: `~${this.who}` } : held.location
    const written = await this.write(target, held.body, {
      addressed: held.addressed,
      // Carried across the two questions, or `reply 2 <something>` typed by
      // somebody without an account would quietly become an answer to the post.
      toReply: held.toReply,
      elsewhere: held.elsewhere,
      // The sentence is four or five lines up, behind the signup questions.
      echoed: false,
    })

    // The heading is written after the write and not before it, or a send that
    // failed prints "and here it is:" above the reason it is not.
    if (!written.failed) lines.push({ text: 'and here it is:', tone: 'accent' }, { text: '' })
    lines.push(...written.lines)

    /*
     * Losing the sentence here would be the worst possible moment for it — and
     * handing it back as bare words is barely better, because the prompt is a
     * command line: pressing Enter on `four pounds of tomatoes` answers
     * `i don't know "four"` and the sentence is gone for real. So what goes
     * back is the line that would send it, aimed where it was aimed.
     */
    return {
      lines,
      identity: this.who,
      retry: written.failed ? retryLine(target, held) : undefined,
      answered: written.answered,
    }
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
   * Leaving this device, and nothing else.
   *
   * The name goes from the prompt, the held sentence goes with it, and the
   * posts stay exactly where they are — which is the part worth saying out
   * loud, because "log out" reads as "remove me" to plenty of people.
   */
  async signOut(): Promise<{ lines: Line[]; identity: string | null }> {
    if (this.who === null) {
      return {
        lines: [{ text: 'you’re already reading as a guest.', tone: 'faint' }],
        identity: null,
      }
    }

    const was = this.who
    const result = await this.api.logout()
    if (!result.ok) {
      // Still signed in, and told so. Saying "you're out" while the cookie is
      // there is the one answer that could actually hurt somebody, on the
      // shared machine this command exists for.
      return { lines: [{ text: result.reason, tone: 'error' }], identity: was }
    }

    // Everything the session was holding on this person's behalf.
    this.who = null
    this.mode = 'command'
    this.held = null
    this.pendingName = null
    this.pending = null
    this.explainedAddresses = false
    this.paging = null

    return {
      lines: [
        { text: `signed out. this browser isn’t ${was} anymore.`, tone: 'accent' },
        { text: `everything ${was} said is still there — login ${was} comes back.`, tone: 'faint' },
      ],
      identity: null,
    }
  }

  /**
   * Ask for a key by name, for a browser that has no session to read.
   *
   * Nothing about the session changes *here* — a key in an inbox is a claim
   * nobody has proved yet, and the proof is producing it. What changed is where
   * the proof can happen: it used to be `/auth/callback` and nowhere else,
   * which meant it happened in whichever browser opened the link.
   *
   * That is the bug, reported by hand. A mail app opens links in a browser it
   * owns, with cookies of its own; the key gets spent there, and the browser
   * the person is reading in stays a stranger. Choosing "open in Safari"
   * afterwards cannot help, because by then the key is gone.
   *
   * So the same key also comes as six characters, and typing them proves the
   * same thing without a browser being involved at all. The link still works,
   * and on a computer it is still one click.
   */
  async signIn(raw: string): Promise<Line[]> {
    const name = raw.trim().toLowerCase()
    if (name === '') {
      return [{ text: 'login who? try: login ryan', tone: 'error' }]
    }

    if (this.who !== null && name === this.who.toLowerCase()) {
      return [
        { text: `you’re already signed in as ${this.who}.`, tone: 'faint' },
        { text: 'say something, or look to see the rooms.', tone: 'faint' },
      ]
    }

    const result = await this.api.login(name)
    if (!result.ok) {
      return [{ text: result.reason, tone: 'error' }]
    }

    const lines: Line[] = [{ text: result.note, tone: 'accent' }]

    // Somebody signed in as one person asking for another's key is about to
    // find themselves switched, which is a surprise worth spending a line on.
    if (this.who !== null) {
      lines.push({
        text: `you’re ${this.who} until you use it — it makes this browser ${result.name}.`,
        tone: 'faint',
      })
    }

    // No code on this deployment — no mail configured, or a provider that does
    // not mint one. The link is the only door, so do not open a question whose
    // answer never arrives.
    if (!result.codeSent) return lines

    return [...lines, ...this.askForCode(result.name)]
  }

  /**
   * The question, and re-asking it, in one place.
   *
   * A wrong code has to come back to the same question rather than dropping to
   * the command prompt: somebody who mistypes one character of six should be
   * able to type six more, not work out that they need to run `login` again and
   * wait for another email.
   */
  private askForCode(name: string, problem?: Line): Line[] {
    const question: Line[] = problem ? [problem] : []
    question.push(
      { text: 'type the short code from the email.', tone: 'accent' },
      {
        // Said because it is the entire reason the code exists, and because
        // somebody who has already tapped the link needs to know why they are
        // being asked for something else.
        text: 'it signs you in here, in this browser — a link opened from a mail app usually lands somewhere else.',
        tone: 'faint',
      },
    )

    return this.askOne(question, async (text) => {
      const code = text.trim()
      const result = await this.api.loginCode(name, code)

      if (!result.ok) {
        return { lines: this.askForCode(name, { text: result.reason, tone: 'error' }) }
      }

      this.who = result.name
      return {
        lines: [
          { text: `you’re ${result.name} again, on this device.`, tone: 'accent' },
          { text: 'say what you like, as often as you like.', tone: 'faint' },
        ],
        identity: result.name,
      }
    })
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
    options: {
      addressed?: boolean
      toReply?: number
      elsewhere?: boolean
      /**
       * Whether the sentence is still on the screen above this.
       *
       * Everything below prints the address and not the words, because the
       * words are on the echo line one row up. After signup they are not: the
       * name question, the terms line, the email question and the key note sit
       * between, so "and the thing you were trying to say is up" pointed at
       * something four or five lines gone — reported as "nowhere do i see the
       * thing i was trying to say. I have to type look to see it."
       *
       * So the rule this function follows does not change, it just gets told
       * the truth. When the echo is out of sight the post prints its body too,
       * in the room's own grammar, which is what `look` would have shown.
       */
      echoed?: boolean
    } = {},
  ): Promise<WriteResult> {
    if (!location.room) {
      return {
        lines: [{ text: 'you have to be in a room to say something.', tone: 'error' }],
        failed: true,
      }
    }

    /*
     * Print the address, or print nothing. Never print a word about whether it
     * worked.
     *
     * "Do you need something to tell you it's said? Shouldn't that be the
     * assumption unless there's an error?" — yes, and that is the oldest
     * convention there is: `cp` says nothing on success. `said.` was a status
     * report, and a status report on a line of its own under every sentence is
     * how a prompt turns into a chat client with delivery receipts.
     *
     * What survives is not a confirmation, it is a value: the address. It is
     * the one thing about the post that is *not* already on the screen — your
     * own words are right there on the echo line above — and there is no other
     * way to get it without walking back into the room. That is exactly the
     * `git commit` shape: one line, the identifier, no adjectives.
     *
     * Silence would have been wrong as a blanket rule for one specific reason:
     * `lib/data/live.ts` deliberately drops your own posts from the realtime
     * channel, so nothing arrives to show you. In a real terminal `cp` is
     * silent and you believe it because the filesystem is right there; here the
     * room does not visibly change. So the rule is not "say nothing", it is
     * "say the thing that is not otherwise knowable" — which for a reply and
     * for commons is nothing at all.
     */
    try {
      if (location.postId !== undefined) {
        const replyNo = await this.writer.reply(
          location.room,
          location.postId,
          body,
          options.toReply,
        )
        /*
         * The reply's own header, in the grammar the thread prints.
         *
         * This used to be the post's address — `music/12` — on the reasoning
         * that a reply had no address of its own (§4.3) and the post was the
         * only true thing to give back. A reply has a number now, and that
         * changes which fact is worth printing: the post address is already on
         * the screen, in the prompt, one line below. The number is not, and it
         * is the thing somebody else needs in order to answer *you*.
         *
         * Same shape as a new post's confirmation, and the same shape the
         * thread will show it in when it is read back — so what you see when
         * you write it is what it looks like.
         *
         * The post's address comes back in front of it when the reply went
         * somewhere you are not standing. `reply music/12 <something>` can be
         * typed from another room entirely, and then the prompt does not say
         * where it went — so this line is the only place it is ever said, and a
         * bare reply number would be a receipt for a conversation you cannot
         * see. The rule is the same one the rest of this function follows: print
         * what is not otherwise on the screen.
         */
        const at = options.elsewhere ? `${location.room}/${location.postId}  ` : ''
        const lines: Line[] = [
          {
            text: `${at}${replyNo}  ${this.who ?? 'you'}, ${formatAgo(new Date())}${
              options.toReply === undefined ? '' : `  → ${options.toReply}`
            }`,
            tone: 'dim',
          },
        ]
        if (options.echoed === false) lines.push({ text: body, depth: 1 })
        return {
          answered: { room: location.room, postId: location.postId },
          lines,
          failed: false,
        }
      }
      const postNo = await this.writer.post(location.room, body)

      /*
       * Commons gets a number from the allocator like everywhere else and it
       * means nothing there: §3.10 keeps no threads, `go 26` in commons answers
       * "there's nothing to open here", and the post is gone in a day. There is
       * no address, so there is no output.
       */
      if (options.addressed === false) {
        /*
         * Commons has no address, so with the echo above it there is nothing
         * left to print but a word — and with the echo gone there is nothing on
         * the screen at all. The two cases are genuinely different and this is
         * the one place that shows it most starkly: `said.` under a signup
         * exchange is a receipt for something the person cannot see.
         */
        if (options.echoed === false) {
          return {
            lines: [
              { text: `${this.who ?? 'you'}, ${formatAgo(new Date())}`, tone: 'dim' },
              { text: body, depth: 1 },
            ],
            failed: false,
          }
        }
        /*
         * The one place a word survives, because it is the one place with no
         * address to give instead. Accent, like every other confirmation — the
         * complaint that started this was not that a word existed, it was that
         * it was faint enough to read as "that didn't send".
         */
        return { lines: [{ text: 'said.', tone: 'accent' }], failed: false }
      }

      /*
       * The whole address, never the bare number — and this is now the simpler
       * rule as well as the correct one.
       *
       * `go 7` only works while you are standing in the room the 7 belongs to,
       * and saying something on your own wall can happen from two places that
       * are not it — your page, and the feed, where a bare number is refused
       * outright because 7 is a different post on every wall. That used to be a
       * special case for walls. As a lone line with no sentence around it, a
       * bare `7` is also just cryptic, so the special case disappears into the
       * general rule: print what `go` takes from anywhere, which is what every
       * other listing on the site prints too.
       */
      const address = `${location.room}/${postNo}`

      /*
       * The explanation is said once, and then never again.
       *
       * "Why do I even need to know what the number is if I'm sending it?" is a
       * fair question, and the answer — it is the address, it is where replies
       * arrive, it is the same thing in the URL (§3.4) — is worth a line the
       * first time somebody posts. It is worth nothing the fourth time.
       *
       * A thing you need told once and a thing you need told always are
       * different lines, and printing the first as though it were the second is
       * how an interface that explains itself turns into one that nags.
       */
      /*
       * The post's own header, in the room's own grammar — not a receipt.
       *
       * `poker/5` alone is a filing reference. Everywhere else on this site a
       * thing somebody said is headed `address  author, when`, so printing half
       * that grammar at the one moment somebody has made such a thing meant
       * your post had two appearances: a reference when you wrote it, and a
       * post when you read it back. Reported that way — "if you press look and
       * the page reloads, now your message shows in the same way other people's
       * message shows."
       *
       * Same line count, no words repeated. `ryan, just now` is redundant to
       * the author and that is the point: it is what everybody else will see,
       * shown at the moment it becomes true.
       *
       * And dim, which reverts a deliberate change rather than forgetting it.
       * That change made this accent because it was the only bright thing on
       * screen after a contribution — the echo above it, including the sentence
       * itself, was all `--fg-dim`, so the one line saying "that happened" had
       * to carry the weight. `echoOf` moved that weight to where it belongs:
       * the sentence is now the brightest thing on the line above. A header is
       * a header, and the room prints headers dim.
       */
      const lines: Line[] = [
        {
          text: `${address}  ${this.who ?? 'you'}, ${formatAgo(new Date())}`,
          tone: 'dim',
        },
      ]
      // Under the header, indented, exactly where the room puts it — so the
      // first post somebody ever makes looks like a post rather than a receipt.
      if (options.echoed === false) lines.push({ text: body, depth: 1 })
      if (!this.explainedAddresses) {
        this.explainedAddresses = true
        lines.push({
          text: `that’s where it lives — go ${address} opens it, and replies land there.`,
          tone: 'faint',
          hint: true,
        })
      }

      return { lines, failed: false }
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
