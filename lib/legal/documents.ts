/**
 * The terms and the privacy policy, as data.
 *
 * One source, two surfaces — the same reasoning as §3.4's prompt path and URL.
 * `terms` and `privacy` in the shell print the short version; `/terms` and
 * `/privacy` render the whole thing for people who are not signed in, for
 * anyone who wants to read it before typing an address into the prompt, and for
 * the processors below, who require a published policy to exist.
 *
 * These are written against what the code actually does, which is the part a
 * template cannot do: the retention periods, the processor list and the data
 * inventory were read out of the schema and the routes, not guessed. They are
 * not legal advice, and nobody here is a lawyer — if this ever carries money or
 * a company, have someone qualified read them.
 */

export const CONTACT = 'hello@thewall.social'
export const LAST_UPDATED = '5 August 2026'

export interface Jurisdiction {
  /** e.g. "the State of California", "Ontario", "Ireland". */
  law: string
  /** The courts that hear a dispute. e.g. "San Francisco County, California". */
  courts: string
}

/**
 * Where the person running this is, which is the only thing that decides the
 * governing-law clause. **This is the one setting these documents still need.**
 *
 * Not where visitors are. That is the confusion worth naming, because it is the
 * one everybody has: somebody in the UK using the site does not make UK law
 * govern the terms. Their protection comes from two other places, both already
 * written and both unaffected by this — the privacy policy is written to the
 * GDPR, and the Law section preserves consumer rights that cannot be signed
 * away wherever the reader lives, including their right to sue locally. A site
 * can be governed by one law and still owe every visitor what their own law
 * guarantees them.
 *
 * Returns null until it is set, and the documents say so loudly rather than
 * naming somewhere plausible. A clause that names the wrong place is worse than
 * one admitting it is unfinished: the first is a false statement on a published
 * page, the second is a to-do.
 *
 * A function rather than a constant because TypeScript narrows a `const`
 * initialised to `null` down to `null`, which makes the branch that renders a
 * real jurisdiction unreachable — the compiler would reject the very edit this
 * exists to invite.
 *
 * To go live, return the place:
 *
 *     return { law: 'the State of California', courts: 'San Francisco County, California' }
 */
export function jurisdiction(): Jurisdiction | null {
  /*
   * "The United States" is not, by itself, a governing law for something like
   * this. Contract and consumer law in the US is state law — there is no
   * federal body of it to choose — so a clause reading "governed by the laws of
   * the United States" names nothing a court can apply, which is the exact
   * failure this function's null case exists to avoid.
   *
   * So this names a state as well, and the state is the operator's own. Change
   * `law` and `courts` together if that is not where you are; they are one
   * decision and a mismatched pair is worse than either.
   */
  return {
    law: 'the State of Arizona, United States',
    // The state's courts rather than one named county. Naming a county pins
    // every dispute to a courthouse the operator may not live near for long,
    // and the Law section below already preserves a consumer's right to sue
    // where they are — so a narrower clause would buy nothing and cost that.
    courts: 'the State of Arizona',
  }
}

export interface Section {
  heading: string
  body: readonly string[]
}

export interface Document {
  title: string
  path: string
  /** What the shell prints. Long enough to be honest, short enough to read. */
  summary: readonly string[]
  sections: readonly Section[]
}

export const PRIVACY: Document = {
  title: 'privacy',
  path: '/privacy',
  summary: [
    'reading thewall is anonymous. no account, no cookie, no analytics, no trackers.',
    'if you make an account we keep the name you chose, your email address, and what you post.',
    'if you make a room, we record that you made it. nobody else can see that.',
    'your email is never shown to anyone and never sold. it exists to send you a sign-in link.',
    'what you post is public — that is the point of posting.',
    'you can have all of it deleted by writing to ' + CONTACT + '.',
    '',
    'the whole policy is at thewall.social/privacy.',
  ],
  sections: [
    {
      heading: 'Who is responsible',
      body: [
        `thewall.social is run by one person. For anything in this policy — access, deletion, correction, or a complaint — write to ${CONTACT} and you will get a human.`,
        'If you are in the UK or EU, that person is the "controller" for the purposes of the UK GDPR and the EU GDPR. There is no Data Protection Officer, because the scale does not require one.',
      ],
    },
    {
      heading: 'Reading, without an account',
      body: [
        'You can read every room, every post and every reply without telling us anything. There is no sign-up wall.',
        'No analytics. No advertising. No third-party trackers. No cookies are set for reading — the only cookie this site ever sets is the one that keeps you signed in, and it is only set after you make an account.',
        'Our host records ordinary web server logs (IP address, time, page requested) as every web server does. Those are the host\'s, retained on their schedule, and we do not build anything on top of them.',
      ],
    },
    {
      heading: 'What we hold if you make an account',
      body: [
        'Your name. Public — it appears on everything you post, and at thewall.social/~yourname.',
        'Your email address. Never public, never shown to other users, never sold, never used for marketing. It exists to send you a sign-in link, because there are no passwords here.',
        'What you post and reply. Public, along with the time you posted it.',
        'When you signed up, when you last read your mail, and when your current name was taken.',
        'Names you have previously used. Not public: a name is shown as "previously somebody else\'s" only as a date, never attached to a person, so renaming to get away from a name actually works.',
        'Which rooms you opened, if you make any. Not public — the site never shows who made a room, and the database does not let a browser read it either. It is held so the three-a-week limit can be counted, and so there is a record if a room needs looking at.',
        'When you agreed to the terms, and which version of them. Not public. It is the record that you were asked and answered, and it is deleted with your account.',
        'A one-way hash of the IP address you signed up from. Used to stop one person creating a hundred accounts. It is a SHA-256 digest, not an address, and it is not linked to your account — it is kept for one hour and deleted.',
      ],
    },
    {
      heading: 'Why we are allowed to hold it',
      body: [
        'Your name and your posts: to perform the contract you entered into by making an account. Without them there is no service to provide.',
        'Your email address: the same, plus our legitimate interest in being able to let you back in on a new device.',
        'Which rooms you opened: our legitimate interest in enforcing a limit that keeps the place usable, and in being able to answer for a room if somebody complains about one.',
        'Your agreement to the terms: our legal obligation to be able to show what was agreed, and our legitimate interest in not having to guess later.',
        'The signup IP hash: our legitimate interest in not being overrun by automated accounts. It is the least identifying thing that answers the question, and it is short-lived.',
        'We do not rely on consent for any of it, which means there is nothing to withdraw — if you want out, deletion is the lever, and it is below.',
      ],
    },
    {
      heading: 'How long it is kept',
      body: [
        'Posts in commons are deleted after 24 hours, automatically and unconditionally. This is enforced by the database, not by a cleanup job that could be turned off.',
        'Posts in every other room are kept until you ask for them to be removed.',
        'Your account is kept until you ask for it to be deleted.',
        'A room you opened outlives your account. When you are erased the link between you and it is removed, and the room stays — by then the conversations in it belong to everybody who turned up, and taking it down would delete their words to satisfy a request that was never about them.',
        'Signup rate-limit hashes are kept for one hour.',
        'Previously used names are kept for 90 days, then stop being consulted; they are deleted outright when you close your account.',
      ],
    },
    {
      heading: 'Who else sees it',
      body: [
        'Supabase — the database and the sign-in system. Your name, email and posts live there. Supabase Inc., United States, under Standard Contractual Clauses.',
        'Netlify — hosting. Sees requests and server logs, not the database. Netlify Inc., United States, under Standard Contractual Clauses.',
        'Resend — the sign-in emails. Sees your email address and the link sent to it. Resend Inc., United States, under Standard Contractual Clauses.',
        'That is the complete list. Nobody buys this data, because it is not for sale, and there is no advertising network to sell it to.',
      ],
    },
    {
      heading: 'Your rights',
      body: [
        `Write to ${CONTACT} and we will act within 30 days.`,
        'Access — a copy of everything held about you.',
        'Correction — anything wrong, fixed. Your name you can change yourself, whenever you like: type rename.',
        'Deletion — your email address and your name are erased, permanently. What you posted stays up by default, attached to a handle that is nobody, because deleting it would also delete the replies other people wrote underneath it. If you want your posts taken down as well, say so and they will be.',
        'Portability — your posts, as a file you can take elsewhere.',
        'Objection and restriction — say what you object to and we will stop.',
        'If you are unhappy with the answer, you can complain to the data protection authority where you live — the Information Commissioner\'s Office in the UK, or your national supervisory authority anywhere in the EU. That right is yours wherever this site is run from, and nothing in the terms changes it.',
      ],
    },
    {
      heading: 'Children',
      body: [
        'This is not for people under 16. We do not knowingly hold anything about anyone younger, and if we learn we have, it is deleted.',
      ],
    },
    {
      heading: 'Security, honestly stated',
      body: [
        'Traffic is encrypted in transit. There are no passwords to lose, because there are none. Access to the database is limited to the one person who runs it.',
        'This is a small project run by one person, not an enterprise with a security team. Do not put anything here you would be harmed by seeing in public.',
      ],
    },
    {
      heading: 'Changes',
      body: [
        `Last updated ${LAST_UPDATED}. If this policy changes in a way that matters, the change will be announced in commons before it takes effect.`,
      ],
    },
  ],
}

export const TERMS: Document = {
  title: 'terms',
  path: '/terms',
  summary: [
    'be a person. don’t post things that are illegal, or aimed at hurting someone.',
    'what you write stays yours. posting it here gives us permission to show it here, nothing more.',
    'you can change your name whenever you like. the one you leave behind is free for anyone.',
    'you can make rooms, three a week. a room you make is not yours — it has no owner.',
    'this is one person’s side project. it can break, and it can end.',
    'accounts can be removed for the things above, and you can ask why.',
    ...(jurisdiction()
      ? []
      : ['', 'heads up: the governing law clause isn’t filled in yet.']),
    '',
    'the whole thing is at thewall.social/terms.',
  ],
  sections: [
    {
      heading: 'What this is',
      body: [
        'thewall.social is a small social site run by one person as a side project. It is free, it makes no money, and it comes with no promises about uptime, backups or how long it will exist.',
        'Reading does not require agreeing to anything. There is no account, nothing is stored about you, and you can close the tab having left nothing behind. These terms are about having an account.',
      ],
    },
    {
      heading: 'When you agree to this',
      body: [
        'When you make an account, and not before. The prompt says so at the moment it asks for your email address, and names the command that shows you this document — the account is created by what you type next, so that is the point of agreement.',
        'The date and the version you agreed to are recorded against your account. If this document changes, that record still says which wording you accepted.',
        'Accounts made before that record existed have nothing stored, and are marked as such rather than backdated.',
        'If you do not want to agree, do not make an account. Everything on this site is readable without one.',
      ],
    },
    {
      heading: 'Your account',
      body: [
        'You need to be 16 or older.',
        'One person, one account, unless you are asked otherwise. Making accounts in bulk is the one thing here with an automated defence, and it will simply stop working.',
        'Your name is yours while you hold it. You can change it as often as you like by typing rename — and the name you leave is immediately available to anyone else. If that matters to you, do not release a name you want to keep.',
        'A name that has recently changed hands is marked as such on the profile of whoever holds it now, so nobody can quietly inherit your conversations.',
      ],
    },
    {
      heading: 'What you post',
      body: [
        'You keep the copyright in everything you write. Nothing here transfers ownership.',
        'By posting, you give permission to store what you wrote and show it to other people on this site. That permission lasts as long as the post is up and ends when it comes down. It does not extend to selling it, licensing it to anyone else, or training anything on it.',
        'You are responsible for what you post, and you confirm you have the right to post it.',
        'Posts in commons are deleted after 24 hours. This is not a setting.',
      ],
    },
    {
      heading: 'Rooms you make',
      body: [
        'Anyone with a verified account can make a room, three in any seven days. It needs a name and a line saying what it is for, and both are public.',
        'Making a room does not make it yours. There is no owner, no moderator and no special powers — inside it you are exactly another person in a room, and everything below about what not to post applies to you there like anybody else.',
        'You cannot take a name somebody is using, or one the site needs for its own pages. Nothing stops you naming a room after a subject, a joke or a mood.',
        'A room drops out of the lobby when nothing has been said in it for a fortnight. It is not deleted — it keeps its name, its posts and its address, it can still be found by searching, and it comes back the moment somebody speaks in it.',
        'A room can be closed, the same way a post can be hidden, if what is happening in it breaks the rules below. That is reversible and nothing in it is destroyed.',
        'If you close your account, rooms you made stay. The record that you made them goes with your account; the rooms belong to the conversations in them by then.',
      ],
    },
    {
      heading: 'What not to post',
      body: [
        'Anything illegal where you are, or where this is hosted.',
        'Threats, harassment, or content meant to make someone unsafe.',
        'Content that sexualises children, in any form. This is reported, not just removed.',
        'Other people\'s private information — addresses, phone numbers, workplaces — without their agreement.',
        'Malware, phishing, or links intended to harm whoever clicks them.',
        'Spam, advertising, and automated posting. This is a conversation between people.',
        'Impersonating somebody else, including by taking a name in order to be mistaken for its previous holder.',
        'All of this applies to what you call a room and what you say it is for, as much as to what you post in one.',
      ],
    },
    {
      heading: 'What happens when somebody breaks that',
      body: [
        'Posts can be hidden, rooms can be closed, and accounts can be stopped from posting. All three are reversible, and nothing is destroyed when any of them happens — the replies other people wrote stay where they are.',
        `You can ask why, at ${CONTACT}, and you will get an answer from a person. If it was a mistake it will be undone.`,
        'There is no formal appeals process, because there is no formal moderation team. There is one person, and they will read your email.',
      ],
    },
    {
      heading: 'Leaving',
      body: [
        `Write to ${CONTACT} and your account will be closed: your address and your name erased, permanently.`,
        'What you posted stays up by default, attached to a handle that belongs to nobody, because deleting it would delete the replies other people wrote underneath it. If you want your posts down too, say so and they will come down.',
      ],
    },
    {
      heading: 'No promises',
      body: [
        'This is provided as it is. There is no warranty of any kind, no guarantee it will be available, and no guarantee that anything you post will still be here tomorrow. Keep your own copy of anything you would miss.',
        'To the extent the law allows, the person running this is not liable for anything arising from your use of it. Nothing here limits liability for death, personal injury, or fraud, because it cannot.',
        'This site can be shut down at any time, for any reason, including boredom. You would be told first if there is any way to tell you.',
      ],
    },
    {
      heading: 'Other people’s content',
      body: [
        'What other people post is theirs, not ours. It is not reviewed before it appears. If you see something that breaks the rules above, write to the address below.',
      ],
    },
    {
      heading: 'Changes',
      body: [
        `Last updated ${LAST_UPDATED}. Changes that matter are announced in commons before they take effect, and the announcement says what changed rather than only that something did.`,
        'If a change materially reduces your rights, continuing to post after it is how you accept it — and if you would rather not, deletion is a sentence away and takes your address and your name with it.',
      ],
    },
    {
      heading: 'Law',
      body: [
        jurisdiction()
          ? `These terms are governed by the law of ${jurisdiction()!.law}, and the courts of ${jurisdiction()!.courts} have jurisdiction.`
          : 'GOVERNING LAW IS NOT SET YET. Whoever is running this has not filled it in, so no choice of law is being claimed here. Until they do, any dispute falls where the ordinary rules of private international law put it.',
        'Wherever you are, this does not take away rights your own law gives you that cannot be signed away. If you are a consumer in the UK, the EU, or anywhere with mandatory consumer protection, you keep all of it — including the right to bring a claim in your own local courts, and everything in the privacy policy above, which is written to the GDPR and applies to you regardless of which law governs these terms.',
      ],
    },
  ],
}

export const DOCUMENTS: readonly Document[] = [TERMS, PRIVACY]
