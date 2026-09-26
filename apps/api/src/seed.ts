import type { BoardStore } from "./projection.js";

// Placeholder content for a fresh board — arbitrary, obviously-a-placeholder entries so a new tab
// isn't blank, not a stand-in for anyone's real board. Only seeded into a fresh, empty event log
// (see CLAUDE.md — never the owner's actual tasks). Points are integer thousandths of a percent
// (1% → 1000).

const DAILY = [["First daily task", 1000]] as const;

const WEEKLY = [["First weekly task", 1000]] as const;

const REGISTRY: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, number]>]> = [
  ["First registry task", [["Tier 1", 1000]]],
];

const TASKS = [["First task", 1000]] as const;

// Non-destructive migration for boards created before streaks existed: add the Streaks tab if it's
// missing, without touching anything else. (A fresh board gets it via seedIfEmpty, examples and all.)
export function ensureStreaksTab(store: BoardStore): void {
  if (store.listSections().some((s) => s.kind === "streaks")) return;
  store.seedSection("Streaks", "#ef4444", [{ type: "checkbox" }], "streaks");
}

// Non-destructive migration: the Registry tab offers tiered + repeatable tasks. Older boards had it
// tiered-only (or, older still, with a stray `checkbox`); bring them in line so the add-task type
// picker offers both. Existing tasks are untouched — allowedTypes only gates creation. Seed/migration
// code, so keying off the seeded "Registry" name is fine (like ensureStreaksTab keys off kind);
// idempotent — only emits when the allowed set isn't already exactly {tiered, repeatable}.
const REGISTRY_TYPES = [{ type: "tiered" as const }, { type: "repeatable" as const }];
export function ensureRegistryTypes(store: BoardStore): void {
  const registry = store.listSections().find((s) => s.kind === "tasks" && s.name === "Registry");
  if (!registry) return;
  const want = new Set(REGISTRY_TYPES.map((t) => t.type));
  const current = new Set(registry.allowedTypes.map((a) => a.type));
  const same = current.size === want.size && [...want].every((t) => current.has(t));
  if (same) return;
  store.setSectionAllowedTypes(registry.id, REGISTRY_TYPES);
}

// Non-destructive migration: backfill the recurrence `period` onto pre-existing Daily/Weekly/Registry
// tabs (boards created before scheduled boxes / period resets existed) so their cadence — scheduled
// boxes and which roll unchecks them — is read off the tab, not chosen per task. Seed/migration code,
// so keying off the seeded name is fine (like ensureRegistryTieredOnly). Idempotent — skips a section
// that already has a period.
export function ensureSectionPeriods(store: BoardStore): void {
  for (const [name, period] of [["Daily", "day"], ["Weekly", "week"], ["Registry", "day"]] as const) {
    const section = store.listSections().find((s) => s.kind === "tasks" && s.name === name && !s.period);
    if (section) store.setSectionPeriod(section.id, period);
  }
}

// The non-board infrastructure every board needs regardless of content: just settings today.
// Idempotent. Kept separate from the demo seed so a reset can rebuild only this (an empty board)
// without the placeholder tabs/tasks coming back. Periods are intentionally NOT started here — a
// fresh/reset board has no open period, so the UI prompts the owner to start their first day/week.
export function initializeInfra(store: BoardStore): void {
  store.seedSettings();
}

// One entry point for bringing any board up to date on boot: seed a fresh one with placeholder
// content, run the non-destructive migrations for older ones, and ensure the infra above. Idempotent.
export function initializeBoard(store: BoardStore): void {
  seedIfEmpty(store);
  ensureStreaksTab(store);
  ensureRegistryTypes(store);
  ensureSectionPeriods(store);
  initializeInfra(store);
}

export function seedIfEmpty(store: BoardStore): void {
  if (!store.isEmpty()) return;

  const daily = store.seedSection("Daily", "#22c55e", [{ type: "checkbox" }], "tasks", "day");
  const weekly = store.seedSection("Weekly", "#3b82f6", [{ type: "checkbox" }], "tasks", "week");
  const registry = store.seedSection("Registry", "#f59e0b", [{ type: "tiered" }, { type: "repeatable" }], "tasks", "day");
  const tasks = store.seedSection("Tasks", "#1e293b", [{ type: "checkbox" }]);
  // The streaks tab holds streaks, not tasks; allowedTypes is unused for it but the schema wants one.
  const streaks = store.seedSection("Streaks", "#ef4444", [{ type: "checkbox" }], "streaks");

  const dailyByText = new Map<string, string>();
  for (const [text, points] of DAILY) {
    dailyByText.set(text, store.createTask({ sectionId: daily.id, type: "checkbox", text, points }).id);
  }
  for (const [text, points] of WEEKLY) {
    store.createTask({ sectionId: weekly.id, type: "checkbox", text, points });
  }
  for (const [text, tiers] of REGISTRY) {
    store.createTask({
      sectionId: registry.id,
      type: "tiered",
      text,
      tiers: tiers.map(([label, points]) => ({ label, points })),
    });
  }
  for (const [text, points] of TASKS) {
    store.createTask({ sectionId: tasks.id, type: "checkbox", text, points });
  }

  // One example streak so the tab isn't empty. Placeholder, like the tasks above — editable/removable
  // through the UI.
  store.createStreak({
    sectionId: streaks.id,
    name: "First streak",
    type: "daily",
    mode: "all",
    since: "created",
    matcher: { kind: "tasks", conditions: [{ taskId: dailyByText.get("First daily task")!, required: 1 }] },
  });
}
