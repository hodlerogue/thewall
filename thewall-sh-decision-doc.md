# thewall.sh — decision document

**Status:** parked concept. Not in the 60-day sprint.
**Purpose:** capture the design that converged so it isn't lost, name what's unresolved, and define what would have to happen for this to earn build hours.
**Domain:** thewall.sh (available as of this writing) + one .com redirect.

---

## 1. What this is

A social site where the entire interface is a command prompt. Rooms, posts, and replies are navigated the way a filesystem is navigated. No feed algorithm, no infinite scroll, no buttons pretending to be a terminal — a real prompt with a real command set, made legible to people who have never opened one.

**What it isn't:** a business. See §7.

---

## 2. What this is actually for

The honest framing: this is a **distribution asset**, not a product.

It is inherently screenshottable, explains itself in one sentence, and is the kind of object that circulates on its own. It gives the build-in-public narrative something people will share, and it puts a memorable artifact under the Git Shipped name while Git Shipped and Ferly do the revenue work.

If it is ever evaluated as a revenue product, it fails on the criteria in §7. Evaluate it as marketing that happens to be software.

---

## 3. Resolved design

These held up against every objection raised during design. They compose rather than conflict, which is the main reason the concept is worth keeping at all.

### 3.1 Space is a filesystem

- **Lobby** → **rooms** → **posts** → **replies**
- `go <room>` at the lobby, `go <number>` inside a room
- `leave` backs out one level, always, from anywhere
- The prompt displays current location: `jameson:music/12$`

Why it works: navigation state is displayed in the exact place the user is already looking. A GUI needs a highlighted nav item to answer "where am I." A terminal answers it for free.

### 3.2 A post is a room

Threads are not rendered, they are entered. `go 12` puts you inside a conversation. This solves thread display in a linear interface — depth becomes location instead of a rendering problem.

Consequence: no tree characters, no `└─`, no box drawing. Indentation encodes depth (post flush, replies +16px, reply body +32px) and survives a 380px viewport.

### 3.3 `say` is contextual

One verb for all contribution:
- In a room → starts a new post
- Inside a post → adds a reply

There is no `reply` verb to learn; it exists only as an alias. The entire posting model is one word meaning "contribute to wherever you're standing."

### 3.4 Post IDs are permanent, never positional

Post 12 is post 12 forever. Positional numbering is a correctness bug — a post arriving between read and reply sends the reply to the wrong place.

Free consequence: `thewall.sh/music/12` is the same address as the prompt. Shareable URLs fall out of the design at zero cost.

### 3.5 English verbs are canonical; Unix names are aliases

| Canonical | Aliases |
|---|---|
| `look` | ls, see, list, show, rooms |
| `go` | cd, enter, open, join, read |
| `say` | wall, post, reply, write, talk |
| `who` | people, online, users |
| `leave` | back, exit, up, cd .. |
| `what` | man, explain, info, ? |
| `help` | commands, h |

Terminal-literate users type the short forms and feel clever. Everyone else never learns there was a joke. Aliasing is never announced.

**This reverses an earlier decision.** The original vocabulary (`wall`, `motd`, `write`, `who`) was chosen for insider delight and directly caused the "how is anyone supposed to know what these do" failure. The Unix names survive as aliases only.

### 3.6 The palette is a glossary, not a toolbar

Every command chip reads `verb — what it does`, not just the verb. Always visible, contextual to location, and it doubles as the mobile input method.

- Chips **insert** text into the prompt with the cursor waiting; they do not execute
- This teaches syntax rather than replacing it — users graduate to typing on their own timeline
- Set changes by context (lobby / room / post), so it never exceeds ~6 items regardless of total command count

### 3.7 Errors teach

- Unknown input guesses the nearest verb *and shows its description*
- Wrong-context commands name the fix (`say` in the lobby → "you have to be in a room first. try: go music")
- No error codes, no "invalid syntax"

### 3.8 `what <command>` replaces `man`

Plain-English description first, alias list second. This is where terminal users discover the shorthand and everyone else confirms they never needed it.

### 3.9 Signup is deferred to first contribution

**Reading is anonymous.** `look`, `go`, every room, every thread — no account. The prompt reads `guest:lobby$` in muted gray.

**The first `say` triggers signup.** Friction lands at peak motivation: someone who has just typed a sentence they want to send is the most willing they will ever be to give you a name.

Flow, one question per line, in the prompt itself:
1. `what do you want to be called?` — validates, checks collision, suggests alternates on conflict
2. `where should i send your key?` — email, magic link, no password
3. **The held message posts automatically.** Signup ends with "now — the thing you were trying to say," and it goes through. The user never re-types their sentence.

Design notes:
- No password. Passwords in a prompt are a genuine problem — echoed to screen, no masking. Magic link sidesteps it entirely. **Passkeys are the better option on mobile** (one tap) and should be evaluated first.
- No form, no confirm-password, no captcha. The prompt is already a single-field input, so conversational is the native shape here, not a compromise.
- `cancel` at any point returns to reading with nothing lost.
- Guest state is ambient, never nagging. `who` tells guests they aren't listed yet and why.

This supersedes the earlier `join <name>` upfront-command idea, which put a gate in front of a product whose entire first impression is "look around."

### 3.10 `commons` is the default room, not a speakable lobby

You start in `commons`. It sits in the room list as a **peer**, not as special structure — posts still only exist in rooms, and the lobby proper is one `leave` away and stays a pure directory.

**Why not a speakable lobby:** the default space always wins. Discord's `#general`, the subreddit daily thread — a home feed absorbs all activity and starves the topic rooms, which deletes the geography that makes this feel like a place.

**The rule that defuses it: `commons` doesn't keep anything.**
- Posts expire in 24 hours
- No permanent IDs, no threads
- If something there is worth keeping, someone moves it into a topic room

It's a hallway, not a room. That gives you an always-warm default space without letting it become the site.

**What this buys:** cold start gets much easier — one space to keep alive instead of five — and a new arrival can talk immediately without first deciding which room they belong in.

### 3.11 The lobby shows proof of life

`look` at the lobby lists each room with its most recent activity: last post, how long ago, who said it. Not a feed, not postable.

Costs nothing, and it's the difference between a busy building and a list of doors.

---

## 4. Open questions

Ordered by how much they change the build.

### 4.1 Notifications — UNSOLVED, highest priority

Nothing currently tells you someone replied. **No notification means no reason to return**, which makes this the difference between a place people try and a place people check.

Unix precedent is the login line:
```
you have 3 replies waiting — type mail
```

Open: does `mail` list replies, or drop you into a room of them? Does it show at login only, or persist in the status bar? Is there any push at all, or is this deliberately a pull-only product?

**Lean:** status bar shows the count persistently; `mail` lists them with `go <id>` to jump. Pull-only, no push, no email. That's on-brand and it's less to build.

### 4.2 Room creation and the ghost town problem

`look` showing 40 rooms with three people each kills the entire feeling. The room list is the first impression and it must always look alive.

Options:
- **Fixed set, curated.** ~5 rooms, hand-picked, no user creation. Safest.
- **Earned creation.** Room creation unlocks after N posts or N days. Adds a progression mechanic.
- **Rooms decay.** A room with no activity in 7 days is hidden from `look` and archived. Self-cleaning.

**Lean:** fixed set at launch, decay rules written but not enabled. Revisit only if rooms stay warm without intervention.

### 4.3 Nesting depth

Currently: replies are flat, one level. No reply-to-reply.

Allowing `go 12/3` gives real threading and also gives you Reddit, where half the value is buried and a terminal has no good way to signal it's down there.

**Lean:** stay flat permanently. Make it a stated constraint, not an unbuilt feature. Conversations under ~30 people are flat in reality.

### 4.4 Mobile

The palette solves input (tap to insert, no thumb-typing of flags). Untested: whether the scrollback model works on a 380px viewport, and whether the prompt staying pinned above the keyboard is achievable without fighting mobile browsers.

**This is where the concept most plausibly dies.** Social lives on phones. Prototype mobile before anything else.

### 4.5 The purity trade

Every legibility fix moves this toward being a chat app with typed input. `look — see what's around you` is, functionally, a labeled button.

Each concession was individually correct. Cumulatively they erode the thing that made it interesting. The differentiated version stays slightly hostile; the hostile version has a much smaller ceiling.

**Unresolved and it's a taste call, not an analysis call.** Decide it deliberately rather than by accumulation.

### 4.6 Name permanence

Currently names are permanent. In a small community your handle is your identity, and a rename breaks every reply that addresses you by name.

But permanent means someone who picks badly at 2am is stuck with it, and that's a real reason to leave.

**Lean:** one free rename, ever. Old name stays reserved and dead so nobody can impersonate. Cheap to build, covers the actual failure case.

### 4.7 Email verification before posting

The flow posts immediately and sends the key in parallel. Better UX, and it means throwaway addresses get in.

For a small community that's fine — the manual kill switch handles it. At any scale it isn't, and there is no moderation tooling in scope to absorb the difference.

**Lean:** unverified posting at launch, with a rate limit on new accounts. Revisit the moment volume makes the kill switch impractical.

### 4.8 Composability

The thing separating "real interface" from "terminal costume" is commands that chain:
```
posts --tag=poker --since=7d | star
```
Not built, not designed. If it never ships, this is a themed UI. If it ships, it justifies the premise entirely.

**Lean:** one working pipe at launch, documented only inside `what posts`, discoverable by the curious. Don't advertise it.

---

## 5. Cold start

An empty room is worse than no room. The demo cannot launch to a ghost town.

- Seed `commons` plus 4–5 topic rooms with real content before anyone arrives. `commons` is the one that must never look empty (§3.10)
- One room should be a **mood, not a topic** (`latenight` — quiet hours only). Mood rooms are what make it feel like a place rather than a forum
- Content must read like ordinary people: broken AC, a bad beat, a dad's records in the garage, four pounds of tomatoes. **Not** dev in-jokes — that was the first draft's failure and it narrows the audience to people who already like terminals
- Launch coordinated, not gradual. A trickle of arrivals into empty rooms is the failure mode

---

## 6. Weekend build scope

If built, this is a **two-day toy**, not a platform. Anything beyond this list is scope creep.

**In:**
- Lobby / room / post navigation with permanent IDs
- `look` `go` `say` `who` `leave` `what` `help` + full alias table
- Contextual glossary palette
- Fuzzy error handling with suggestions
- 5 seeded rooms
- Anonymous reading; deferred signup triggered by first `say` (§3.9) — no forms anywhere
- Magic-link auth with held-message commit
- URL routing that mirrors the prompt path

**Out (v1):**
- Notifications (design first, per §4.1)
- Private messages
- User-created rooms
- Pipes and flags (one, hidden, if time allows)
- Any moderation tooling beyond a manual kill switch
- Mobile app of any kind

**Stack:** Next.js + Supabase. Realtime subscriptions for room presence. No new infrastructure.

---

## 7. Why this isn't a business

Recorded so the question doesn't get re-litigated from scratch later.

- **Social monetizes through scale.** This is structurally niche by design and will not reach scale.
- **Subscriptions don't work on a network with no network.** Nobody pays to enter an empty room.
- **Moderation, abuse, and legal exposure land on a solo dev.** Unbounded, unpaid, and it doesn't stop once it starts.
- **No revenue path inside 60 days**, which is the only window that currently matters.

---

## 8. Trigger conditions

**Build the weekend version when:** there is a genuine gap between outreach sprints, or a launch moment where having a shareable artifact is worth more than the two days. Not before.

**Reconsider as a real product only if all three:**
1. 2,000+ people try it without paid acquisition
2. Rooms stay warm for 30 days without founder participation
3. A specific, named monetization path exists that is not advertising

**Kill it if:** mobile prototype fails (§4.4), or it hasn't been built within 90 days of this document — at which point the moment has passed and the idea should be closed rather than carried.

---

## 9. Discarded, with reasons

| Discarded | Why |
|---|---|
| Unix-canonical vocabulary (`wall`, `motd`) | Insider delight at the cost of comprehension |
| Hex post IDs (`0x1f`) | Cute, hostile, no benefit over integers |
| Positional post numbers | Correctness bug — replies land on the wrong post |
| Full command list in the palette | Doesn't scale past ~8 commands |
| Chips that execute on click | Makes it a button UI wearing a terminal costume |
| `cmdwall.com` | `cmd` reads as Windows; name isn't typeable as a command |
| A speakable lobby / home feed | Default spaces absorb all activity and starve the rooms |
| `join <name>` upfront signup command | Gates a product whose first impression is "look around" |
| Passwords | Can't mask input in a prompt; no benefit over magic link |
| Green-on-black as final palette | Obvious choice; worth testing something warmer to separate from every other terminal-themed site |
