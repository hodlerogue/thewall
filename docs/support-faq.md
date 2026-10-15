# Support bot — questions and answers

For the AI support bot embedded on the feedback room. These are the questions
it offers proactively, with the answers it should give. The first five are
where people actually got stuck while the site was being built; the rest cover
everything else a newcomer is likely to ask.

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

## 2. I'm signed out, or on a new device. How do I get back in?

Type `login` followed by your name — for example `login ryan`. We'll email you
a short code. Type the code into the prompt and you're back.

The email also has a link, which works fine on a computer. On a phone, use the
code: tapping the link in a mail app often opens it in that app's own browser,
which signs in the wrong window.

If the email doesn't arrive, check spam, then type `resend`.

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

Type `go` and the room's name to walk straight in — `go cycling` — or search
for it with `find --rooms cycling`. Say something in it and
it's back in the lobby. The rooms that came with the site never drop off.

## 5. What emails will I get, and what's kept about me?

At most one email a day, and only on days somebody replied to you. Type
`notify off` to stop them — every one also has a link at the bottom that does
the same.

Your email address is never shown to anyone. Type `privacy` for exactly what's
kept, who can see it, and how to have your account deleted — and `terms` for
the rules.

## 6. How do I reply to someone?

Open the post by its number — `go 12` opens post 12 — and type `say` followed
by your reply. Inside a post, `reply 2 good point` answers reply number 2
specifically.

You can also answer without opening the post: in a room, `reply 12 same here`
answers post 12, and `reply music/12 same here` works from anywhere. The words
go on the same line. Tapping a number on the screen types it for you.

## 7. What are the numbers next to posts?

They're addresses. Every post in a room gets the next number, and it keeps it
for good — so `go 12` always opens the same post, and `music/12` is a link you
can share. Replies inside a post are numbered the same way.

## 8. How do I see if anyone has replied to me?

Type `mail`. It lists replies to things you've said, newest nearest the prompt,
each with the address to go to. A line above the prompt also tells you when
replies are waiting.

## 9. What is commons, and why did my post disappear?

Commons is the room you start in, and it keeps nothing: everything said there is
gone after 24 hours. That's deliberate — it's for passing remarks. If you want
something to stay, post it in another room; `rooms` shows them all.

## 10. How do I write something longer than one line?

Type `write`, then your post one line at a time. Leave a blank line for a new
paragraph, and type a line with just a period on it to send it. Posts can be
up to 4,000 characters. `cancel` throws the draft away.

## 11. How do I get back to the main list of rooms?

Type `lobby` (or `home`) from anywhere. `leave` goes back one step instead —
from a post to its room, and from a room to the lobby.

## 12. Can I change my name?

Yes — type `rename` followed by the new name. Everything you've said moves to
the new name. Be careful: your old name is released immediately and anyone can
take it.

## 13. How do I see someone's profile, or post on my own wall?

Type `go` and a tilde with their name — `go ~marisol` — to see who they are and
what's on their wall. On your own page, `say` posts to your wall, where anyone
can reply. `go feed` shows what everyone has put on their walls.

## 14. Can I find something someone said?

Type `find` followed by a word — `find tomatoes`. Add `--room`, `--by` or
`--since` to narrow it, for example `find tomatoes --by=marisol --since=7d`.
`who` shows who's around right now.

## 15. Can I put it on my phone, or change how it looks?

Type `install` to add it to your home screen so it opens full screen like an
app (on iPhone it'll tell you which two taps to make). `theme` changes the
colours — warm, black, green or light — and `hints off` hides the little
suggestions if you'd rather not see them.

---

## Anything else

If the bot can't answer, the person can post in this room — `say` followed by
the problem — and it'll be seen. `help` lists everything that can be typed from
wherever they are, and `what` followed by a command explains that one in detail.
