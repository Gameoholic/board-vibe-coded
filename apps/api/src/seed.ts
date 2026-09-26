import type { BoardStore } from "./projection.js";

// Placeholder content standing in for the owner's real board, transcribed from the whiteboard photo.
// Not a permanent fixture (see CLAUDE.md) — only seeded into a fresh, empty event log. Points are
// integer thousandths of a percent (2.5% → 2500).

const DAILY = [
  ["Reset board", 80],
  ["Brush teeth", 80],
  ["Weigh in", 40],
  ["Workout", 830],
  ["Obsidian", 420],
  ["Floss", 80],
] as const;

const WEEKLY = [
  ["Workout A", 2500],
  ["Workout B", 3750],
  ["Workout C", 2500],
  ["Stretches", 830],
  ["Visit Grandparents", 5000],
  ["Shopping", 3750],
  ["Shave", 630],
  ["Social", 5000],
] as const;

const REGISTRY: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, number]>]> = [
  ["Immersion", [["1hr", 2500], ["2hr", 5000], ["3hr", 7500]]],
  ["Japanese VC", [["15min", 630]]],
  ["Geki", [["1hr", 2500], ["2hr", 5000], ["3hr", 7500]]],
  ["Piano", [["15min", 630], ["30min", 1250], ["1hr", 2500]]],
  ["Art", [["30min", 1250], ["1hr", 2500], ["2hr", 5000]]],
  ["NASA", [["Tier 1", 1250], ["Tier 2", 2500], ["Tier 3", 5000], ["Tier 4", 10000]]],
  ["Max dead hang", [["Attempt", 210]]],
  ["Japan Planning", [["Tier 1", 1250], ["Tier 2", 2500], ["Tier 3", 5000]]],
];

const TASKS = [
  ["Clean PC", 1500],
  ["Sticker paper for wardrobe", 1000],
] as const;

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
  const weeklyByText = new Map<string, string>();
  for (const [text, points] of WEEKLY) {
    weeklyByText.set(text, store.createTask({ sectionId: weekly.id, type: "checkbox", text, points }).id);
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

  // Two example streaks so the tab isn't empty: a daily one on Workout, and a weekly "all three
  // workouts" streak. Placeholder, like the tasks above — editable/removable through the UI.
  store.createStreak({
    sectionId: streaks.id,
    name: "Daily workout",
    type: "daily",
    mode: "all",
    since: "created",
    matcher: { kind: "tasks", conditions: [{ taskId: dailyByText.get("Workout")!, required: 1 }] },
  });
  store.createStreak({
    sectionId: streaks.id,
    name: "Full week of lifts",
    type: "weekly",
    mode: "all",
    since: "created",
    matcher: {
      kind: "tasks",
      conditions: ["Workout A", "Workout B", "Workout C"].map((t) => ({
        taskId: weeklyByText.get(t)!,
        required: 1 as const,
      })),
    },
  });
}
