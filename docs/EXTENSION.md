# The browser extension (parked)

> **Parked 2026-11-16** by the owner until accounts (`ACCOUNTS.md`) are done; pick it up from the open calls below and the Video Gate Trials artifact.
>
> **Scope of this file.** The plan for a Firefox extension that puts the shop between the owner and YouTube. Started 2026-11-14 in a brainstorm; nothing here is built. Once a step is built, what it does moves into `PRODUCT.md` / `ARCHITECTURE.md` and its box here is ticked.

## Why (the owner's words, not concrete)

- The shop's timed rewards (YouTube) only work if the owner logs the minutes — "I don't always update the %", and sometimes "just watch YouTube disregarding the shop system and the board completely".
- It's a choice, not forgetting: the owner **chooses to dodge** it.
- "The fact that I can click with zero consequence. It's kind of like opening Instagram reels out of habit."
- "I need a second to confirm that I did indeed want to watch it and see how much % it'd take, and for it to actually take it at the end. Or at the very least, to tell me at the end how much % I need to take so I feel the pain of taking it away MYSELF."

## Settled

- **It gets in the way, it doesn't just count** (owner: they dodge on purpose, so a passive counter would be dodged too).
- **A pause on the way in** (owner): opening the site stops first on a screen saying what a minute costs, and you confirm you mean it.
- **The bill at the end** (owner): leaving charges the minutes watched.
- **Proposal — the extension takes the % itself, and the taking is a moment you watch.** Deducting it by hand is the very step that gets dodged today; the pain comes from seeing it drain, not from typing it. (Owner's fallback was "at least tell me, and I take it myself".) *Not yet confirmed.*
- **Proposal — no site is named in code.** A timed reward gets a list of sites it covers (`youtube.com`); the extension guards whatever sites the shop lists. YouTube is the owner's data; Instagram could be the next row. (Prime directive 1.)
- **Proposal — it reuses what exists:** the timed reward's stopwatch (`RewardTimerSet`) runs while watching, and the end is the existing purchase with `minutes`. No second pricing rule.
- **Proposal — the extension signs in with its own key**, made and revoked in Settings, not the board's session cookie (a cookie meant for the board shouldn't be lent to a browser add-on, and SameSite would fight it anyway).

## The order (draft)

- [ ] A timed reward can list the sites it covers (shop form + API).
- [ ] An extension key in Settings, and the API accepting it for the few calls the extension needs.
- [ ] The extension: the pause on the way in, the stopwatch while there, the charge on the way out.
- [ ] The charge as a felt moment (game-feel, per `PRODUCT.md` → "Design language").

## Open

To pick these by feel: **Video Gate Trials** (https://claude.ai/artifact/VMiKENCsm7yaTZP3NdxjKZ) plays six ways it could work beside a mock board (confirm & charge, you pay it, prepay, live meter, a wait at the door, say how long), with these calls as switches. Its "Calls to confirm" list is kept in step with this section.

- **When you can't afford it** — blocked outright, or let through with points going negative? (Asked; no default yet.)
- **What "the end" is** — closing the tab, leaving the site, or going idle (paused video, tab in the background)? Proposed default: the stopwatch runs only while a covered tab is in front and a video is playing.
- **Dodging the dodge-blocker** — the extension can be switched off in two clicks, and it doesn't see the phone or other browsers. Proposed: the board shows when the extension last checked in, so turning it off is at least visible; the phone is out of scope for now.
- **Where the bill shows once the tab is closed** — the tab is gone, so there's no page to play the charge on: the board opens to take it, or it's only a notification? (Raised by the engineer.)
- **A 50-second peek is free** — the shop rounds minutes down (`minutesOn`), so short peeks never cost anything: keep it, or round up for the extension? (Raised by the engineer.)
