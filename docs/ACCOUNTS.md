# Accounts

> **Scope of this file.** The plan for real accounts: several people, each with their own board, on one install. Started 2026-11-16 in a brainstorm; accounts, the migration and invite links are built (see `PRODUCT.md` / `ARCHITECTURE.md`). Once a step is built, what it does moves into `PRODUCT.md` / `ARCHITECTURE.md` and its box here is ticked. The browser extension (`EXTENSION.md`) is parked until this is done.

## Why (the owner's words, not concrete)

- A friend wants access to the board. Today it's one shared password, so the only way in is the owner's own board.
- "I want real accounts support with several people on one install, minimal changes required by me, and a CLEAN migration losing NONE of the current data, it's very important."

## Settled

- **Real accounts, several people, one install** (owner). Not a second copy of the app.
- **Zero data loss in the migration; the owner does next to nothing by hand** (owner).
- **Completely separate and super private** (owner, 2026-11-16): "nobody knows of each other's existence even." No shared features, no list of people, nothing in one board that hints another exists. Never to be quietly reversed for a "social" feature.
- **Proposal — the login never tells on anyone:** a wrong name and a wrong password get the same answer in the same time, so it can't be used to check whether someone has an account. No public sign-up page that would do the same.
- **Proposal — even the owner can't open another account's board.** Being the one who makes accounts isn't a key to them.
- **Accounts come from invite links** (owner accepted): the owner makes a one-time link in Settings, the friend opens it and picks her own name and password, and the link dies once used. No public sign-up.
- **A device stays logged in forever** (owner): log in once and never type the password again on that device. Proposal for how: browsers cap a cookie's life at 400 days whatever the server asks (today's "10 years" is quietly cut to that), so the server renews the cookie on every visit; it only lapses on a device unused for over a year. The cookie names whose session it is, so changing one person's password logs out only their devices.
- **English only** (owner): no translation.
- **Built on its own branch** (owner accepted): every step lands on the accounts branch, tried against a copy of the local data, and the owner merges it into `main` (which deploys to the VPS) only when all of it works, so a half-built migration never runs on the real data there.
- **This replaces a standing scope line**: "single user" in `PRODUCT.md` and "Auth: one shared password, no accounts" in `ARCHITECTURE.md` → "Security". Both get rewritten when the first step lands.
- **Proposal — one database file per account.** The owner's existing `board.db` becomes their account's file by being *moved*, not rewritten: no event is touched, so nothing can be lost or mangled, and the 2,600-line projection doesn't need a user id threaded through every query. Two people can't see each other's data because their data isn't in the same file. (The alternative, a `userId` on every event in one shared log, means rewriting history and trusting every query to filter, and is exactly how one person's tasks end up on someone else's screen.)
- **Proposal — what's per account:** the event log, settings, backups, and the debug clock (today a single global in `clock.ts`, so one person's debug time would bend everyone's board). One small accounts file beside them holds each account's name and password hash.
- **Proposal — the migration runs itself on boot:** if accounts don't exist yet but `auth.json` and `board.db` do, it takes a backup, makes the owner's account from the existing password hash (the same password keeps working), and moves the file in. Locally and on the VPS alike, with nothing to type. The owner logs in once more afterwards (the cookie has to start saying *whose* session it is).
- **Proposal — a new account starts on the placeholder board** a fresh install gets today (`seed.ts`), never a copy of the owner's.

## The order (draft)

- [x] The accounts file and the per-account store, with the owner's board moved in on boot (backup first), behind a name + password login. Owner confirmed 2026-11-16 on a copy of the local data: "yeah it's all there". On branch `claude/accounts-ea5a65`.
- [x] Per-account backups, settings and debug clock (folded into step 1).
- [x] Docs: `PRODUCT.md` / `ARCHITECTURE.md` stop saying "single user" (done in step 1, on the branch).
- [x] Invite links: the owner makes a one-time link in Settings; the friend picks her name and password. Spec approved 2026-11-16: only the owner's account can invite; a link lives until used or 7 days, is shown once (only its hash is kept), and can be cancelled; a dead link always gets the same message; the password is typed twice; "That name's taken" is the one accepted leak. Plus a Log out button (no way back to another account without one).
- [ ] A limit on login attempts (proposed by the engineer: the VPS is on the internet, and with names there's something to guess against).

Step 1's spec (approved 2026-11-16): the owner's account is `daniel`; the old cookie is still accepted and swapped on the next visit; the debug clock moves per account in step 1. Rolling the code back after the update would show an empty board (the data is safe in `data/accounts/`).

**Merged into `main` and pushed 2026-11-16 at the owner's call** ("let's just push this… if there's any big changes I'll tell you after it's pushed"), before the attempt limit and before the owner tried invites themselves (the session tried them on a throwaway install).

## Open

- The limit on login attempts is the one step left.
