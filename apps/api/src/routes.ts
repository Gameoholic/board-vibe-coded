import { type Request, Router } from "express";
import {
  ApplyFormulaBody,
  BreakDownBody,
  CreateGroupBody,
  CreateRewardBody,
  CreateShopSectionBody,
  CreateStreakBody,
  CreateTaskBody,
  DebugClockBody,
  PointsFormula,
  PatchGroupBody,
  PatchRewardBody,
  PatchSettingsBody,
  PatchShopSectionBody,
  PatchStreakBody,
  PatchTaskBody,
  RerollBountyBody,
  RecolorSectionBody,
  ReorderBody,
  type RewardEditFields,
  RollPeriodBody,
  type ShopSectionEditFields,
  type StreakEditFields,
  StreakReorderBody,
  type Task,
  type TaskEditFields,
} from "@board/contracts";
import type { Backups } from "./backup.js";
import { getDebugNow, setDebugNow } from "./clock.js";
import type { BoardStore } from "./projection.js";
import { initializeInfra } from "./seed.js";

// Thin transport layer: every body is parsed through a contract schema (throws ZodError → 400 via
// the error middleware) before the command layer runs. No business logic lives here.

/** An optional client-supplied key that makes a retried write a no-op instead of a duplicate event. */
function idemKey(req: Request, tag: string): string | null {
  const key = req.header("Idempotency-Key");
  return key && key.trim() ? `${key.trim()}:${tag}` : null;
}

export function buildRouter(store: BoardStore, backups: Backups): Router {
  const router = Router();

  router.get("/sections", (_req, res) => {
    res.json(store.listSections());
  });

  router.patch("/sections/reorder", (req, res) => {
    const { orderedIds } = ReorderBody.parse(req.body);
    res.json(store.reorderSections(orderedIds, idemKey(req, "sections-reorder")));
  });

  router.patch("/sections/:id", (req, res) => {
    const { color } = RecolorSectionBody.parse(req.body);
    res.json(store.recolorSection(req.params.id, color, idemKey(req, "recolor")));
  });

  // Tabs are fixed once created — deleting one is intentionally unsupported (see PRODUCT.md).
  router.delete("/sections/:id", (_req, res) => {
    res.status(405).json({ error: "tabs are fixed" });
  });

  router.patch("/sections/:id/reorder", (req, res) => {
    const { orderedIds } = ReorderBody.parse(req.body);
    res.json(store.reorderTasks(req.params.id, orderedIds, idemKey(req, "tasks-reorder")));
  });

  router.get("/tasks", (req, res) => {
    const sectionId = typeof req.query.sectionId === "string" ? req.query.sectionId : undefined;
    res.json(store.listTasks(sectionId));
  });

  router.post("/tasks", (req, res) => {
    const body = CreateTaskBody.parse(req.body);
    res.status(201).json(store.createTask(body, idemKey(req, "create")));
  });

  // A PATCH is a bundle of independent edits; each present field is applied as its own command.
  router.patch("/tasks/:id", (req, res) => {
    const body = PatchTaskBody.parse(req.body);
    const id = req.params.id;
    let task: Task | undefined;

    if (body.done !== undefined) task = store.setDone(id, body.done, idemKey(req, "done"));
    if (body.activeTier !== undefined) task = store.setTier(id, body.activeTier, idemKey(req, "tier"));
    if (body.progress !== undefined) task = store.setProgress(id, body.progress, idemKey(req, "progress"));

    const changes: TaskEditFields = {};
    if (body.text !== undefined) changes.text = body.text;
    if (body.points !== undefined) changes.points = body.points;
    if (body.estimate !== undefined) changes.estimate = body.estimate;
    if (body.estimateMinutes !== undefined) changes.estimateMinutes = body.estimateMinutes;
    if (body.estimateEffortIndex !== undefined) changes.estimateEffortIndex = body.estimateEffortIndex;
    if (body.pointsSource !== undefined) changes.pointsSource = body.pointsSource;
    if (body.description !== undefined) changes.description = body.description;
    if (body.tiers !== undefined) changes.tiers = body.tiers;
    if (body.count !== undefined) changes.count = body.count;
    if (body.schedule !== undefined) changes.schedule = body.schedule;
    if (Object.keys(changes).length > 0) task = store.editTask(id, changes, idemKey(req, "edit"));

    if (body.timer !== undefined) task = store.setTimer(id, body.timer);
    if (body.pruned !== undefined) task = store.setPruned(id, body.pruned, idemKey(req, "prune"));
    if (body.status !== undefined) task = store.setStatus(id, body.status, body.blocker, idemKey(req, "status"));
    if (body.parentId !== undefined) task = store.setParent(id, body.parentId, idemKey(req, "parent"));
    if (body.frozen !== undefined) task = store.setFrozen(id, body.frozen, idemKey(req, "frozen"));

    res.json(task ?? store.getTask(id));
  });

  // The row menu's "Duplicate": copy a task's definition into a new task placed right after it.
  router.post("/tasks/:id/duplicate", (req, res) => {
    res.status(201).json(store.duplicateTask(req.params.id, idemKey(req, "duplicate")));
  });

  // Break down: the pieces typed in one go, created inside the task. Returns the task, then its pieces.
  router.post("/tasks/:id/pieces", (req, res) => {
    const { texts } = BreakDownBody.parse(req.body);
    res.status(201).json(store.breakDown(req.params.id, texts, idemKey(req, "break-down")));
  });

  // Reorder a task's pieces; `orderedIds` must be exactly its pieces (cf. /sections/:id/reorder).
  router.patch("/tasks/:id/pieces/reorder", (req, res) => {
    const { orderedIds } = ReorderBody.parse(req.body);
    res.json(store.reorderPieces(req.params.id, orderedIds, idemKey(req, "pieces-reorder")));
  });

  router.delete("/tasks/:id", (req, res) => {
    store.deleteTask(req.params.id, idemKey(req, "delete"));
    res.status(204).end();
  });

  // Groups (labeled bundles of a list's contiguous items — a board tab's tasks or a shop tab's
  // rewards). Membership is set on create (item ids) and lives on the items themselves; a group has no
  // order — its place is wherever its members sit. GET lists the board's; the shop's ship with /shop.
  router.get("/groups", (req, res) => {
    const sectionId = typeof req.query.sectionId === "string" ? req.query.sectionId : undefined;
    res.json(store.listGroups(sectionId));
  });

  router.post("/groups", (req, res) => {
    const body = CreateGroupBody.parse(req.body);
    res.status(201).json(store.createGroup(body, idemKey(req, "group-create")));
  });

  router.patch("/groups/:id", (req, res) => {
    const body = PatchGroupBody.parse(req.body);
    let group = store.getGroup(req.params.id);
    if (body.addItemIds?.length)
      group = store.addGroupMembers(req.params.id, body.addItemIds, idemKey(req, "group-members-add"));
    if (body.removeItemIds?.length)
      group = store.removeGroupMembers(req.params.id, body.removeItemIds, idemKey(req, "group-members-remove"));
    if (body.label !== undefined)
      group = store.editGroup(req.params.id, body.label, idemKey(req, "group-edit"));
    res.json(group);
  });

  router.delete("/groups/:id", (req, res) => {
    store.deleteGroup(req.params.id, idemKey(req, "group-delete"));
    res.status(204).end();
  });

  router.get("/streaks", (req, res) => {
    const sectionId = typeof req.query.sectionId === "string" ? req.query.sectionId : undefined;
    res.json(store.listStreaks(sectionId));
  });

  router.post("/streaks", (req, res) => {
    const body = CreateStreakBody.parse(req.body);
    res.status(201).json(store.createStreak(body, idemKey(req, "streak-create")));
  });

  // Registered before "/streaks/:id" so "reorder" isn't captured as a streak id.
  router.patch("/streaks/reorder", (req, res) => {
    const { sectionId, orderedIds } = StreakReorderBody.parse(req.body);
    res.json(store.reorderStreaks(sectionId, orderedIds, idemKey(req, "streaks-reorder")));
  });

  router.patch("/streaks/:id", (req, res) => {
    const body = PatchStreakBody.parse(req.body);
    const changes: StreakEditFields = {};
    if (body.name !== undefined) changes.name = body.name;
    if (body.type !== undefined) changes.type = body.type;
    if (body.mode !== undefined) changes.mode = body.mode;
    if (body.since !== undefined) changes.since = body.since;
    if (body.legacy !== undefined) changes.legacy = body.legacy;
    if (body.legacyBest !== undefined) changes.legacyBest = body.legacyBest;
    if (body.matcher !== undefined) changes.matcher = body.matcher;
    const streak =
      Object.keys(changes).length > 0
        ? store.editStreak(req.params.id, changes, idemKey(req, "streak-edit"))
        : store.getStreak(req.params.id);
    res.json(streak);
  });

  router.delete("/streaks/:id", (req, res) => {
    store.deleteStreak(req.params.id, idemKey(req, "streak-delete"));
    res.status(204).end();
  });

  // ---- shop ----
  // Tabs ("sections") and rewards are owner-defined; a purchase spends the board's points (the server
  // checks affordability). GET returns the whole shop — tabs, rewards and total spent — in one payload.

  router.get("/shop", (_req, res) => {
    res.json(store.getShop());
  });

  router.post("/shop/sections", (req, res) => {
    const body = CreateShopSectionBody.parse(req.body);
    res.status(201).json(store.createShopSection(body, idemKey(req, "shop-section-create")));
  });

  router.patch("/shop/sections/:id", (req, res) => {
    const body = PatchShopSectionBody.parse(req.body);
    const changes: ShopSectionEditFields = {};
    if (body.name !== undefined) changes.name = body.name;
    if (body.color !== undefined) changes.color = body.color;
    res.json(store.editShopSection(req.params.id, changes, idemKey(req, "shop-section-edit")));
  });

  router.patch("/shop/sections/:id/reorder", (req, res) => {
    const { orderedIds } = ReorderBody.parse(req.body);
    res.json(store.reorderRewards(req.params.id, orderedIds, idemKey(req, "rewards-reorder")));
  });

  router.delete("/shop/sections/:id", (req, res) => {
    store.deleteShopSection(req.params.id, idemKey(req, "shop-section-delete"));
    res.status(204).end();
  });

  router.post("/shop/rewards", (req, res) => {
    const body = CreateRewardBody.parse(req.body);
    res.status(201).json(store.createReward(body, idemKey(req, "reward-create")));
  });

  router.patch("/shop/rewards/:id", (req, res) => {
    const body = PatchRewardBody.parse(req.body);
    const changes: RewardEditFields = {};
    if (body.name !== undefined) changes.name = body.name;
    if (body.emoji !== undefined) changes.emoji = body.emoji;
    if (body.cost !== undefined) changes.cost = body.cost;
    if (body.note !== undefined) changes.note = body.note || null;
    res.json(store.editReward(req.params.id, changes, idemKey(req, "reward-edit")));
  });

  router.delete("/shop/rewards/:id", (req, res) => {
    store.deleteReward(req.params.id, idemKey(req, "reward-delete"));
    res.status(204).end();
  });

  router.post("/shop/rewards/:id/purchase", (req, res) => {
    res.json(store.purchaseReward(req.params.id, idemKey(req, "reward-purchase")));
  });

  // ---- settings & periods ----

  router.get("/settings", (_req, res) => {
    res.json(store.getSettings());
  });

  router.patch("/settings", (req, res) => {
    const body = PatchSettingsBody.parse(req.body);
    const settings = store.patchSettings(body, idemKey(req, "settings"));
    // A new pace or a switch back on can make one due now.
    if (body.backup) backups.check();
    res.json(settings);
  });

  // Dry-run a points-formula change: which builder values move (old→new) and how many stay put.
  router.post("/points-formula/preview", (req, res) => {
    const formula = PointsFormula.parse(req.body.formula);
    res.json(store.previewFormula(formula));
  });

  // Apply a formula change; `rebalance` also recomputes existing builder values' points to match.
  router.post("/points-formula/apply", (req, res) => {
    const { formula, rebalance } = ApplyFormulaBody.parse(req.body);
    store.applyFormula(formula, rebalance);
    res.json({ settings: store.getSettings(), tasks: store.listTasks() });
  });

  // Whether a new day/week has begun since the last one was opened — the client polls this on load.
  router.get("/periods/status", (_req, res) => {
    res.json(store.periodStatus());
  });

  // Confirm a period rolled over: close the open one (freezing a snapshot) and open the current one. Ending
  // a day ends its week too once that is over (the week's recap comes back as `week`).
  router.post("/periods/roll", (req, res) => {
    const { kind } = RollPeriodBody.parse(req.body);
    res.json(store.rollPeriod(kind));
  });

  // The open week's Bounties still to win, and the rerolls left.
  router.get("/bounty", (_req, res) => {
    res.json(store.bountyStatus());
  });

  // Reroll one of this week's Bounties onto another task (while rerolls are left). Returns the new one.
  router.post("/bounty/reroll", (req, res) => {
    const { taskId } = RerollBountyBody.parse(req.body);
    res.json(store.rerollBounty(taskId, idemKey(req, "bounty-reroll")));
  });

  // ---- backups ----

  // The saved backups, newest first, and when the next one falls due.
  router.get("/backups", (_req, res) => {
    res.json(backups.list());
  });

  // One backup's board as it was saved — to look at, never to change.
  router.get("/backups/:name", (req, res) => {
    res.json(backups.preview(req.params.name));
  });

  // ---- debug clock ----
  // A backdoor to pin the server's "now" and simulate opening the app at another time. Reads reflect
  // it (period-roll prompts, streak states); writes stamp with it. In-memory only — restart clears it.
  router.get("/debug/clock", (_req, res) => {
    res.json({ now: getDebugNow(), real: new Date().toISOString() });
  });

  router.post("/debug/clock", (req, res) => {
    const { at } = DebugClockBody.parse(req.body);
    setDebugNow(at);
    res.json({ now: getDebugNow(), real: new Date().toISOString() });
  });

  // Reset the whole board: wipe the log and rebuild only the infra (settings + a fresh open day/week),
  // leaving an EMPTY board — no tabs, tasks, streaks or history. Deliberately does not re-seed the
  // placeholder content. Destructive and deliberate (a settings action, confirmed in the UI). Not
  // idempotency-keyed — a reset is always meant to happen when asked.
  router.post("/reset", (_req, res) => {
    store.clearAll();
    initializeInfra(store);
    res.status(204).end();
  });

  // Reset progress but keep the board: wipes all history/state, then rebuilds the current tabs/tasks/
  // streaks fresh (see reseedFromCurrent). Destructive (clears the log), confirmed in the UI.
  router.post("/reset/keep-board", (_req, res) => {
    store.reseedFromCurrent();
    res.status(204).end();
  });

  return router;
}
