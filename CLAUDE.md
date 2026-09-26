# The Board

A personal productivity board replacing a physical whiteboard — daily/weekly checklists and a tiered habit registry, each task worth points, single-user and self-hosted (PC + mobile). Built as if it were a large-team SaaS: clean, reused, carefully, secure — the owner was burned by a messy vibe-coded project before, so **code quality and doing things properly are the point, not just "does it work."**

**This file is the one thing that survives when the owner clears their chat, so it stays a thin index — the real content lives in `docs/`.** Read the docs before touching anything. Keep them current: when the design genuinely changes, update the relevant doc in the same breath rather than letting it drift stale.

## The one rule above all others

**Never hardcode the owner's board** — no task named in code, no `if (task.name === …)`. Everything the owner sees is data over generic primitives, editable through the UI. Full rationale in `docs/CONVENTIONS.md`.

## The docs — what each is for, and what goes in it

| Doc | What it's for | Write here | Don't write here |
| --- | --- | --- | --- |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | How it's built + why it's shaped that way | System structure, data/history model, API surface, component maps, state flow, security architecture, dev gotchas, hard-won implementation traps | Code style, product rationale, unbuilt features |
| **[docs/CONVENTIONS.md](docs/CONVENTIONS.md)** | How we write code & work together | Code style, prime directives, reuse rules, dependency & security coding rules, the working process | System structure, product rationale, future features |
| **[docs/PRODUCT.md](docs/PRODUCT.md)** | Why it exists, who it's for, how it must feel | Owner goals & pain points, product principles, current features from the user's view, design language, deliberate scope decisions | How things are implemented, code style, unbuilt ideas |
| **[docs/BACKLOG.md](docs/BACKLOG.md)** | What's not built yet | Deferred features (with a pointer to the reasoning), known next steps, loose ideas | Anything already built; and nothing here is approved to build |

`ARCHITECTURE.md` is meant to be edited freely as the design evolves — keep it honest about what exists vs. what's intended.

## History note

There was a much larger earlier attempt at this same product. Its durable reasoning has been folded into these docs — the data-model ADRs (append-only log, integer points, frozen-values) into `docs/ARCHITECTURE.md`, the deferred vision into `docs/BACKLOG.md`. **Never regenerate a subsystem wholesale** — that's what soured that attempt. The owner earns back to complexity feature by feature, steering it themselves.

## Stack (one line — details in `docs/ARCHITECTURE.md`)

pnpm monorepo: `apps/web` (React 19 + TS + Vite + framer-motion), `apps/api` (Express + TS, in-memory today). `pnpm install && pnpm dev` runs both; web on http://localhost:5173.
