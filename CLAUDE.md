# Working on thewall

## Communication style

- Explain in plain language first, jargon second.
- Define technical terms inline the first time they appear.
- Lead with what a change does and why it matters, not the mechanics.
- Don't assume CS fundamentals. Assume I'm a capable builder who learns by shipping.
- Skip the architecture lecture unless I ask for it.

## Where things are

- `CHANGING-IT.md` — how the codebase works, and the invariants that have bitten
  before. Read it before changing behaviour.
- `GOING-LIVE.md` — deploying, and the migrations waiting to be applied.
- `thewall-sh-decision-doc.md` — the spec. Never edited: it records what was
  argued, including the parts later decided differently.

## Before pushing

`npm test && npm run test:e2e && npm run test:db && npm run build`, plus
`npx tsc --noEmit` — the build does not typecheck test files, and that has
shipped a broken one before.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
