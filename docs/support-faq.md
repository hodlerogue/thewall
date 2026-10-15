# Support bot — five questions to offer

For the AI support bot embedded on the feedback room. These are the questions
it offers proactively, with the answers it should give. Each comes from a place
people actually got stuck while the site was being built.

Every command in backticks is checked by `lib/guide/support-faq.test.ts` — if
one is renamed or removed, that test fails, so the bot is never left teaching a
command that no longer works. Edit freely; keep commands in backticks.

---

## 1. How do I post something?

Go into a room and type `say` followed by what you want to say — for example
`say this is my first post`. Typing `rooms` lists every room, and `go music`
(or any room's name) walks you into one.

The first time you post, you'll be asked for a name and an email address. There
is no password: we email you a key instead. Your first post goes up straight
away; after that, follow the key in the email to keep posting.

Lost? `help` lists everything you can type from where you are, and `what say`
(or `what` plus any command) explains one in detail.

## 2. I'm signed out, or on a new device. How do I get back in?

Type `login` followed by your name — for example `login ryan`. We'll email you
a short code. Type the code into the prompt and you're back.

The email also has a link, which works fine on a computer. On a phone, use the
code: tapping the link in a mail app often opens it in that app's own browser,
which signs in the wrong window.

If you're not getting the email, check spam, then type `resend`.

## 3. How do I make a room, or change what it says it's for?

Type `make`, the room's name, and a few words about what it's for — for example
`make cycling where you rode this week`. The description can be up to 100
characters and shows at the top of the room.

You need a confirmed email address to make one, and you can make three a week.
If you're standing in another room when you make it, you'll be asked whether
that room should list yours as having "grown out of" it — answer n if not.

Made it and want to change the description? Stand in your room and type
`describe` followed by the new words. Only whoever made a room can do that, and
the rooms that came with the site keep theirs.

## 4. A room I know about isn't in the lobby. Where did it go?

It's still there. Rooms people make drop off the lobby after two weeks with
nothing said in them, so the front page stays a list of places with people in
them rather than a directory of empty ones. Nothing is deleted.

Type `go` and the room's name to walk straight in, or `find --rooms` and a word
to search for it — for example `find --rooms cycling`. Say something in it and
it's back in the lobby.

The rooms that came with the site never drop off.

## 5. What emails will I get, and what's kept about me?

At most one email a day, and only on days somebody replied to you. Type
`notify off` to stop them — every one also has a link at the bottom that does
the same. Replies are always waiting for you inside the site: type `mail`.

Your email address is never shown to anyone. Type `privacy` for exactly what's
kept, who can see it, and how to have your account deleted — and `terms` for
the rules.
