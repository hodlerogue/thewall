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
export const LAST_UPDATED = '4 August 2026'

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
    'if you make an account we keep three things: the name you chose, your email address, and what you post.',
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
        'A one-way hash of the IP address you signed up from. Used to stop one person creating a hundred accounts. It is a SHA-256 digest, not an address, and it is not linked to your account — it is kept for one hour and deleted.',
      ],
    },
    {
      heading: 'Why we are allowed to hold it',
      body: [
        'Your name and your posts: to perform the contract you entered into by making an account. Without them there is no service to provide.',
        'Your email address: the same, plus our legitimate interest in being able to let you back in on a new device.',
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
        'If you are unhappy with the answer, you can complain to your national data protection authority. In the UK that is the Information Commissioner\'s Office.',
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
    'this is one person’s side project. it can break, and it can end.',
    'accounts can be removed for the things above, and you can ask why.',
    '',
    'the whole thing is at thewall.social/terms.',
  ],
  sections: [
    {
      heading: 'What this is',
      body: [
        'thewall.social is a small social site run by one person as a side project. It is free, it makes no money, and it comes with no promises about uptime, backups or how long it will exist.',
        'Using it means agreeing to what is below. If you do not, do not use it — reading is anonymous, so you can walk away having left nothing behind.',
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
      heading: 'What not to post',
      body: [
        'Anything illegal where you are, or where this is hosted.',
        'Threats, harassment, or content meant to make someone unsafe.',
        'Content that sexualises children, in any form. This is reported, not just removed.',
        'Other people\'s private information — addresses, phone numbers, workplaces — without their agreement.',
        'Malware, phishing, or links intended to harm whoever clicks them.',
        'Spam, advertising, and automated posting. This is a conversation between people.',
        'Impersonating somebody else, including by taking a name in order to be mistaken for its previous holder.',
      ],
    },
    {
      heading: 'What happens when somebody breaks that',
      body: [
        'Posts can be hidden and accounts can be stopped from posting. Both are reversible, and nothing is destroyed when either happens — the replies other people wrote stay where they are.',
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
        `Last updated ${LAST_UPDATED}. Changes that matter are announced in commons before they take effect. Continuing to use the site after that is how you accept them.`,
      ],
    },
    {
      heading: 'Law',
      body: [
        'These terms are governed by the law of England and Wales, and its courts have jurisdiction. If you are a consumer somewhere else, this does not take away rights you have there that cannot be signed away.',
      ],
    },
  ],
}

export const DOCUMENTS: readonly Document[] = [TERMS, PRIVACY]
