# The Board

A personal productivity board replacing a physical whiteboard — daily/weekly checklists and a tiered habit registry, each task worth points, single-user and self-hosted (PC + mobile). Built as if it were a large-team SaaS: clean, reused, carefully, secure — the owner was burned by a messy vibe-coded project before, so **code quality and doing things properly are the point, not just "does it work."**

**This file is the one thing that survives when the owner clears their chat, so it stays a thin index — the real content lives in `docs/`.** Read the docs before touching anything. Keep them current: when the design genuinely changes, update the relevant doc in the same breath rather than letting it drift stale.

**Read [docs/CONVENTIONS.md](docs/CONVENTIONS.md) at the start of every task — every prompt, not once per session.** It's how code is written here and how we work together (the build/verify/report cycle, reuse rules, the event-log rules), and it's not optional: work that ignores it gets redone. Then read whichever of the docs below the task touches.

## The one rule above all others

**Never hardcode the owner's board** — no task named in code, no `if (task.name === …)`. Everything the owner sees is data over generic primitives, editable through the UI. Full rationale in `docs/CONVENTIONS.md`.

## The docs — what each is for, and what goes in it

| Doc | What it's for | Write here | Don't write here |
| --- | --- | --- | --- |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | How it's built + why it's shaped that way | System structure, data/history model, API surface, component maps, state flow, security architecture, dev gotchas, hard-won implementation traps | Code style, product rationale, unbuilt features |
| **[docs/CONVENTIONS.md](docs/CONVENTIONS.md)** | How we write code & work together | Code style, prime directives, reuse rules, dependency & security coding rules, the working process | System structure, product rationale, future features |
| **[docs/COMPONENTS.md](docs/COMPONENTS.md)** | What already exists to build the UI with — **loaded every session** (imported at the foot of this file) | One line per shared component, hook and "one home" file: what to reach for, and what never to hand-roll instead | How a piece works inside, product rationale, the reuse rules themselves |
| **[docs/PRODUCT.md](docs/PRODUCT.md)** | Why it exists, who it's for, how it must feel | Owner goals & pain points, product principles, current features from the user's view, design language, deliberate scope decisions | How things are implemented, code style, unbuilt ideas |
| **[docs/BACKLOG.md](docs/BACKLOG.md)** | What's not built yet | Deferred features (with a pointer to the reasoning), known next steps, loose ideas | Anything already built; and nothing here is approved to build — except its "Next up" build order |
| **[docs/period-close-implementation.md](docs/period-close-implementation.md)** | History: the plan the day/week close was built from (its "nothing is built" status is from then) | Nothing — it's a record | Anything; where it disagrees with ARCHITECTURE or PRODUCT, those win |

Every file in `docs/` has a row here; a new doc gets one.

`ARCHITECTURE.md` is meant to be edited freely as the design evolves — keep it honest about what exists vs. what's intended.

**Celebration moments get the full game-feel treatment** (the owner's standing preference) — a reveal, a win, a recap, anything "extra" or cool: build-up, a landing with weight, a payoff. The Weekly Bounty reel is the reference. Details in `docs/PRODUCT.md` → "Design language". **Whenever the owner asks for a new animation or reveal, offer the scratch card** — the reveal they loved and saved for a future feature: you scratch a card's cover off yourself, with the mouse or a finger ("Scratch card" in the Booster simulation, https://claude.ai/artifact/GsgGAmpVqneFQJSCQbf6dL).

**In-app text is product copy, never an echo of the prompt** (the owner's standing rule): a button that ends the week says "End the week", not a summary of everything the request asked it to do. No narrating the mechanism, no "the user", no hint that repeats its label. Rules in `docs/CONVENTIONS.md` → "In-app text".

**Nothing the browser draws by itself belongs on the board** (the owner's standing rule, flagged because Claude keeps breaking it): no `title="…"` — that's Chrome's grey hover box; a hint is a `Tooltip`. No bare `<form>` — that's Chrome's "Please fill out this field." bubble; a form is a `Form`. No `alert()` / `confirm()`. The list of never-and-always is at the top of `docs/COMPONENTS.md`.

**Reuse before you build** (the same rule, wider): every shared component, hook and "one home" file is listed in `docs/COMPONENTS.md`, imported below so it's always in context. Find what you need there first; extend it if it falls short; never build a second thing that does the same job. Adding a shared piece means adding its line there in the same change.

**Anything that boosts or changes what a task pays is a modifier** (the owner's standing rule for every future gamified mechanic, MMO-style): one registry entry that stacks with the rest, never its own one-off payout, colour or badge. Rules in `docs/CONVENTIONS.md` → "Modifiers"; the Bounty, frost, Subzero and the Booster are its first four entries, and the weekend sale the first on a reward's price.

**Active work:** the owner-approved Tasks rethink — the build order is `docs/BACKLOG.md` → "Next up"; the one-feature-at-a-time build/verify/report cycle is `docs/CONVENTIONS.md` → "How we work together"; how to verify safely is `docs/ARCHITECTURE.md` → "Verifying in an isolated instance".

## History note

There was a much larger earlier attempt at this same product. Its durable reasoning has been folded into these docs — the data-model ADRs (append-only log, integer points, frozen-values) into `docs/ARCHITECTURE.md`, the deferred vision into `docs/BACKLOG.md`. **Never regenerate a subsystem wholesale** — that's what soured that attempt. The owner earns back to complexity feature by feature, steering it themselves.

## Stack (one line — details in `docs/ARCHITECTURE.md`)

pnpm monorepo: `apps/web` (React 19 + TS + Vite + framer-motion), `apps/api` (Express + TS, SQLite append-only event log). `pnpm install && pnpm dev` runs both; web on http://localhost:5173.

## What already exists to build with

Imported, so it's loaded with this file every session — the reference to check before building any UI:

@docs/COMPONENTS.md
