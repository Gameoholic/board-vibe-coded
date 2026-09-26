import {
  DebugClockState as DebugClockStateSchema,
  DEFAULT_SETTINGS,
  PeriodRecap as PeriodRecapSchema,
  PeriodStatus as PeriodStatusSchema,
  Group as GroupSchema,
  Section as SectionSchema,
  Settings as SettingsSchema,
  StreakView as StreakViewSchema,
  Task as TaskSchema,
} from "@board/contracts";
import { AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import AppNav, { type AppView } from "./AppNav";
import CardCanvas from "./CardCanvas";
import { groupsApi, withMembership, withOrder, withoutGroup } from "./listOps";
import { CanvasSettingsProvider } from "./useCanvasSettings";
import FlyingPoints, { type Flyer, type FlyOrigin, type Point } from "./FlyingPoints";
import type { FlyerTier } from "./flyerTiers";
import { PeriodPrompt, PeriodRecapCard } from "./PeriodClose";
import PointsCounter, { type PointsCounterHandle } from "./PointsCounter";
import Poof, { type PoofBurst } from "./Poof";
import RebalanceConfirm from "./RebalanceConfirm";
import SectionCard from "./SectionCard";
import SettingsView from "./SettingsView";
import ShopView from "./ShopView";
import type { StreakPayload } from "./StreakForm";
import WindDownOverlay from "./WindDownOverlay";
import { behaviorOf, taskPointValue } from "./types";
import type { FormulaPreview, Group, PeriodKind, PeriodRecap, PeriodStatus, PointsFormula, Reward, Section, Settings, StreakView, Task, TaskSchedule, TaskType, TierDef } from "./types";
import { BoardClockProvider } from "./useBoardClock";
import { useLocalConfig } from "./useLocalConfig";
import { useShop } from "./useShop";
import { uid } from "./uid";
import { useSuppressPasswordManagers } from "./useSuppressPasswordManagers";

function computeTotalPoints(tasks: Task[]): number {
  return tasks.reduce((sum, t) => sum + taskPointValue(t), 0);
}

function App() {
  useSuppressPasswordManagers();
  // Device-local view config (layouts, canvas settings, tab prefs) — one store shared by both canvases.
  const local = useLocalConfig();
  const { config, setCardLayout, setSettings, setTabPref, togglePinnedSort, resetLayouts } = local;
  const shopState = useShop();
  const [sections, setSections] = useState<Section[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [streaks, setStreaks] = useState<StreakView[]>([]);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  // The server's effective "now" — the debug-pinned instant if one is set, else its real clock. Drives
  // the date header (and prefills the debug panel) so a simulated time is visible, not just implied.
  const [debugNow, setDebugNow] = useState<string | null>(null);
  const [realNow, setRealNow] = useState<string>(() => new Date().toISOString());
  const [status, setStatus] = useState<PeriodStatus | null>(null);
  const [recap, setRecap] = useState<PeriodRecap | null>(null);
  // Which period rolls the owner deferred this session — suppressed until reload, then re-offered.
  const [dismissed, setDismissed] = useState<Set<PeriodKind>>(new Set());
  const [view, setView] = useState<AppView>("board");
  // The shop is a mode of the board's place, not a place of its own: same canvas, tabs poofed away.
  const shopOpen = view === "shop";
  const [poof, setPoof] = useState<PoofBurst | null>(null);
  const [loading, setLoading] = useState(true);
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const counterRef = useRef<PointsCounterHandle>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/sections").then((res) => res.json()),
      fetch("/api/tasks").then((res) => res.json()),
      fetch("/api/groups").then((res) => res.json()),
      fetch("/api/streaks").then((res) => res.json()),
      fetch("/api/settings").then((res) => res.json()),
      fetch("/api/periods/status").then((res) => res.json()),
      fetch("/api/debug/clock").then((res) => res.json()),
    ])
      // Validate the API's responses at the trust boundary rather than casting blindly — a shape
      // drift or a bad payload fails loudly here instead of surfacing as a mystery render bug.
      .then(([sectionsData, tasksData, groupsData, streaksData, settingsData, statusData, clockData]) => {
        setSections(SectionSchema.array().parse(sectionsData));
        setTasks(TaskSchema.array().parse(tasksData));
        setGroups(GroupSchema.array().parse(groupsData));
        setStreaks(StreakViewSchema.array().parse(streaksData));
        setSettingsState(SettingsSchema.parse(settingsData));
        setStatus(PeriodStatusSchema.parse(statusData));
        const clock = DebugClockStateSchema.parse(clockData);
        setDebugNow(clock.now);
        setRealNow(clock.real);
      })
      .finally(() => setLoading(false));
  }, []);

  // Advance the effective "now" each minute so a scheduled box unlocks when its time arrives without
  // a manual reload. Cheap (only TaskItems consume the board clock; the cards' layout is untouched)
  // and harmless while a debug time is pinned, since that takes precedence over realNow.
  useEffect(() => {
    const id = setInterval(() => setRealNow(new Date().toISOString()), 60_000);
    return () => clearInterval(id);
  }, []);

  // The first period kind that's rolled over and hasn't been deferred — day takes precedence so the
  // owner closes yesterday before last week. null when nothing's waiting.
  const duePrompt = useMemo<PeriodKind | null>(() => {
    if (!status) return null;
    if (status.day.due && !dismissed.has("day")) return "day";
    if (status.week.due && !dismissed.has("week")) return "week";
    return null;
  }, [status, dismissed]);

  function refreshStatus() {
    fetch("/api/periods/status")
      .then((res) => res.json())
      .then((data) => setStatus(PeriodStatusSchema.parse(data)));
  }

  // Confirm a period rolled: the server closes it (snapshotting live task state), unchecks the tabs
  // recurring on that cadence (banking their points) and opens the current one, returning a recap and
  // the recomputed streaks. We surface the recap and reconcile counts. A first start (no period was
  // open — a fresh/reset board) has nothing to recap, so we skip the card.
  function rollPeriod(kind: PeriodKind) {
    const wasFirst = status?.[kind].openKey === null;
    fetch("/api/periods/roll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    })
      .then((res) => res.json())
      .then((data) => {
        const { recap: r, streaks: s } = data as { recap: unknown; streaks: unknown };
        if (!wasFirst) setRecap(PeriodRecapSchema.parse(r));
        setStreaks(StreakViewSchema.array().parse(s));
        return Promise.all([
          fetch("/api/tasks").then((res) => res.json()),
          fetch("/api/periods/status").then((res) => res.json()),
        ]);
      })
      // The unchecked tasks and the banked points land in the same render, so the counter never dips.
      .then(([tasksData, statusData]) => {
        setTasks(TaskSchema.array().parse(tasksData));
        setStatus(PeriodStatusSchema.parse(statusData));
      });
  }

  // A pending points-formula change awaiting the owner's confirm: the new formula + its dry-run preview.
  const [formulaChange, setFormulaChange] = useState<{ formula: PointsFormula; preview: FormulaPreview } | null>(null);

  // Preview a formula change (dry run), then open the confirm dialog with the affected tasks.
  function requestFormulaChange(formula: PointsFormula) {
    fetch("/api/points-formula/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formula }),
    })
      .then((res) => res.json())
      .then((preview: FormulaPreview) => setFormulaChange({ formula, preview }));
  }

  // Apply the pending formula change; `rebalance` also recomputes existing builder tasks' points. The
  // server returns the fresh settings + tasks (points may have moved), which we adopt wholesale.
  function applyFormulaChange(rebalance: boolean) {
    if (!formulaChange) return;
    fetch("/api/points-formula/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formula: formulaChange.formula, rebalance }),
    })
      .then((res) => res.json())
      .then((data: { settings: unknown; tasks: unknown }) => {
        setSettingsState(SettingsSchema.parse(data.settings));
        setTasks(TaskSchema.array().parse(data.tasks));
      })
      .finally(() => setFormulaChange(null));
  }

  function saveSettings(patch: Partial<Settings>) {
    setSettingsState((prev) => (prev ? { ...prev, ...patch } : prev));
    fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then((res) => res.json())
      .then((data) => setSettingsState(SettingsSchema.parse(data)))
      // Changing the timezone/boundaries re-buckets streaks and can change what period we're in.
      .then(() => {
        refreshStatus();
        refreshStreaks();
      });
  }

  function resetBoard() {
    // A full wipe + re-seed server-side; simplest correct client response is a clean reload so every
    // piece of derived state re-fetches from the fresh board rather than being surgically reconciled.
    fetch("/api/reset", { method: "POST" }).then(() => window.location.reload());
  }

  // Wipe all history/progress but rebuild the current tabs/tasks/streaks. Same clean-reload response.
  function resetKeepBoard() {
    fetch("/api/reset/keep-board", { method: "POST" }).then(() => window.location.reload());
  }

  // Debug clock: pin the server's "now" to an instant (or null to return to real time), then reload
  // so every time-derived surface — the date header, period prompts, streak states — re-reads against
  // the new clock. This is what "Refresh" in the debug panel does.
  function setDebugClock(at: string | null) {
    fetch("/api/debug/clock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ at }),
    }).then(() => window.location.reload());
  }

  // The date the header shows — the server's effective now (debug-pinned or real), so a simulated
  // time is visible rather than silently only affecting prompts/streaks.
  const today = new Date(debugNow ?? realNow);

  const totalPoints = useMemo(() => computeTotalPoints(tasks), [tasks]);
  // Flyers still mid-flight haven't visually "arrived" yet, so we hold their amount back
  // from the displayed total until they land — see landFlyer. totalPoints itself (from
  // task state) is the single source of truth; displayedPoints is purely derived from it,
  // never tracked as separate state, so it can't drift out of sync on quick toggles.
  const pendingGain = useMemo(
    () => flyers.reduce((sum, f) => sum + f.amount, 0),
    [flyers],
  );
  const displayedPoints = totalPoints - pendingGain;
  // Rows whose [%] bracket is currently "in the air" — they hide their own copy so it looks like
  // the bracket left the row rather than being duplicated by it.
  const flyingTaskIds = useMemo(() => new Set(flyers.map((f) => f.taskId)), [flyers]);

  // Where a flyer is aimed. Re-measured rather than cached: the HUD places and drifts itself, so a
  // flyer with a long wind-up asks again at launch (see FlyingPoints' getTarget).
  function counterTarget(): Point | null {
    const rect = counterRef.current?.getRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  }

  function spawnFlyer(taskId: string, amount: number, origin?: FlyOrigin) {
    if (!origin || amount <= 0) return;
    const target = counterTarget();
    if (!target) return;
    const id = uid();
    setFlyers((prev) => [
      ...prev,
      {
        id,
        taskId,
        amount,
        percents: origin.percents,
        // The source element's full box, not just its centre: the flyer is positioned and sized
        // to overlay it exactly, which is what makes the launch look like a handoff.
        from: {
          x: origin.rect.left,
          y: origin.rect.top,
          width: origin.rect.width,
          height: origin.rect.height,
        },
        to: target,
      },
    ]);
  }

  // If a task is unchecked/deselected/deleted while its flyer is still mid-flight,
  // drop the flyer rather than let it resolve against a total that's already moved on.
  function cancelFlyersFor(taskId: string) {
    setFlyers((prev) => prev.filter((f) => f.taskId !== taskId));
  }

  // The tier comes up from the flyer that just landed rather than being re-derived here, so the
  // arrival and the burst can't disagree about how big the award was.
  function landFlyer(id: string, tier: FlyerTier) {
    setFlyers((prev) => prev.filter((f) => f.id !== id));
    counterRef.current?.burst(tier.landing);
  }

  // Switching between the board and the shop bursts every visible tab: scattering as it vanishes into
  // the shop, gathering as it returns (the tab's own fade is CSS, keyed on main.shop-open). Hidden tabs
  // stay laid out in shop mode, so their boxes measure the same either way; each tab's colour is read
  // off its rendered title so the burst matches it.
  function changeView(next: AppView) {
    const direction = view === "board" && next === "shop" ? "out" : view === "shop" && next === "board" ? "in" : null;
    if (direction) {
      const cards = Array.from(document.querySelectorAll('[data-canvas="board"] .board-card'), (el) => {
        const title = el.querySelector(".section-title");
        return { rect: el.getBoundingClientRect(), color: title ? getComputedStyle(title).color : "#94a3b8" };
      }).filter(({ rect: r }) => r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight);
      const id = Date.now();
      setPoof({ id, cards, direction });
      setTimeout(() => setPoof((p) => (p?.id === id ? null : p)), 1100);
    }
    setView(next);
  }

  // The owner's points everywhere — board and shop alike — are what the tasks hold plus what period
  // rolls banked, minus what the shop has spent. `banked` and `spent` are server truth (each is folded
  // from events), so every device agrees.
  const points = displayedPoints + (status?.banked ?? 0) - shopState.shop.spent;

  function buyReward(reward: Reward) {
    shopState.buy(reward);
    counterRef.current?.spend(reward.cost);
  }

  function recolorSection(id: string, color: string) {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, color } : s)));
    fetch(`/api/sections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color }),
    });
  }

  async function addTask(
    sectionId: string,
    payload: { type: TaskType; text: string; points?: number; estimate?: string; estimateMinutes?: number; estimateEffortIndex?: number; pointsSource?: "builder" | "manual"; description?: string; tiers?: TierDef[]; count?: number; schedule?: TaskSchedule },
  ) {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionId, ...payload }),
    });
    const task = TaskSchema.parse(await res.json());
    setTasks((prev) => [...prev, task]);
  }

  // Streak counts are the server's to compute (from completion history), so any task change that
  // could move a linked streak means re-reading them. A full re-fetch is fine for a single-user
  // board; the server is the sole authority on the count.
  // ponytail: refetch all streaks rather than diffing which ones link this task — one small GET.
  function refreshStreaks() {
    fetch("/api/streaks")
      .then((res) => res.json())
      .then((data) => setStreaks(StreakViewSchema.array().parse(data)));
  }

  // One handler for every task type: a click resolves to a target "filled level" (via the type's
  // behaviour), which maps to a field patch and a point delta. No branching on task.type here — a
  // checkbox is the 1-box case, a tier is level = index+1, a count is level = boxes ticked.
  function setLevel(task: Task, level: number, origin?: FlyOrigin) {
    const b = behaviorOf(task);
    const patch = b.patchForLevel(task, level);
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...patch } : t)));
    fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(refreshStreaks); // reconcile linked streak counts once the server has applied the change
    const delta = b.valueAt(task, level) - b.valueAt(task, b.filled(task));
    if (delta > 0) spawnFlyer(task.id, delta, origin);
    else cancelFlyersFor(task.id);
  }

  function removeTask(id: string) {
    cancelFlyersFor(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    fetch(`/api/tasks/${id}`, { method: "DELETE" });
  }

  function editTask(id: string, patch: { text?: string; points?: number; estimateMinutes?: number | null; estimateEffortIndex?: number | null; pointsSource?: "builder" | "manual"; description?: string | null; tiers?: Task["tiers"]; count?: number; progress?: number; schedule?: TaskSchedule }) {
    // Server takes null to clear description/estimate; the local Task shape uses undefined for "none".
    // Only touch a field when the patch carries it (absent = leave as-is).
    const { description: desc, estimateMinutes: est, estimateEffortIndex: eff, ...rest } = patch;
    const local: Partial<Task> = { ...rest };
    if (desc !== undefined) local.description = desc ?? undefined;
    if (est !== undefined) local.estimateMinutes = est ?? undefined;
    if (eff !== undefined) local.estimateEffortIndex = eff ?? undefined;
    // An all-unscheduled array means "no schedule" locally (mirrors the server's normalisation).
    if (Array.isArray(local.schedule) && !local.schedule.some(Boolean)) local.schedule = undefined;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...local } : t)));
    fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  // Reorder a section's tasks. `orderedIds` is the full new task sequence (group members kept
  // contiguous by the block); we write each task's new index back to `order`, then persist.
  function reorderItems(sectionId: string, orderedIds: string[]) {
    setTasks((prev) => withOrder(prev, orderedIds));
    fetch(`/api/sections/${sectionId}/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
  }

  // Task groups — the shared list plumbing (listOps) over this board's tasks; the shop's rewards go
  // through the same helpers in useShop. Creating waits for the server's group (it mints the id);
  // the rest are optimistic.
  async function addGroup(sectionId: string, taskIds: string[]) {
    const group = await groupsApi.create(sectionId, taskIds);
    setGroups((prev) => [...prev, group]);
    setTasks((prev) => withMembership(prev, taskIds, group.id));
  }

  function ejectFromGroup(taskId: string, groupId: string, newOrder: string[]) {
    setTasks((prev) => withMembership(prev, [taskId], undefined));
    const sectionId = tasks.find((t) => t.id === taskId)?.sectionId;
    if (sectionId) reorderItems(sectionId, newOrder);
    groupsApi.removeMembers(groupId, [taskId]);
  }

  function extendGroup(groupId: string, additionalTaskIds: string[]) {
    setTasks((prev) => withMembership(prev, additionalTaskIds, groupId));
    groupsApi.addMembers(groupId, additionalTaskIds);
  }

  function editGroup(id: string, label: string) {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, label } : g)));
    groupsApi.relabel(id, label);
  }

  // Deleting a group ungroups its tasks — clear their groupId locally, drop the group.
  function removeGroup(id: string) {
    setTasks((prev) => withoutGroup(prev, id));
    setGroups((prev) => prev.filter((g) => g.id !== id));
    groupsApi.remove(id);
  }

  async function addStreak(sectionId: string, payload: StreakPayload) {
    const res = await fetch("/api/streaks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionId, ...payload }),
    });
    const created = StreakViewSchema.parse(await res.json());
    setStreaks((prev) => [...prev, created]);
  }

  // Edits can change what the streak matches (type/mode/tasks), so the count is the server's to
  // recompute — apply the definition optimistically, then reconcile count/active from the response.
  function editStreak(id: string, payload: StreakPayload) {
    setStreaks((prev) => prev.map((s) => (s.id === id ? { ...s, ...payload } : s)));
    fetch(`/api/streaks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((res) => res.json())
      .then((data) => {
        const updated = StreakViewSchema.parse(data);
        setStreaks((prev) => prev.map((s) => (s.id === id ? updated : s)));
      });
  }

  function removeStreak(id: string) {
    setStreaks((prev) => prev.filter((s) => s.id !== id));
    fetch(`/api/streaks/${id}`, { method: "DELETE" });
  }

  // Backfill a streak's carried-over values (starting count and/or record-best floor) — edited from the
  // Settings backfill list. Optimistic, then reconcile the server-recomputed count/active/best.
  function backfillStreak(id: string, patch: { legacy?: number; legacyBest?: number }) {
    setStreaks((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    fetch(`/api/streaks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then((res) => res.json())
      .then((data) => {
        const updated = StreakViewSchema.parse(data);
        setStreaks((prev) => prev.map((s) => (s.id === id ? updated : s)));
      });
  }

  function reorderStreaks(sectionId: string, ordered: StreakView[]) {
    setStreaks((prev) => {
      const others = prev.filter((s) => s.sectionId !== sectionId);
      return [...others, ...ordered];
    });
    fetch("/api/streaks/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionId, orderedIds: ordered.map((s) => s.id) }),
    });
  }

  return (
    <div className="page">
      <AppNav view={view} onChange={changeView} />

      {/* The HUD floats over the whole screen; while a period prompt or recap overlay is up it would
          sit on top of that focus surface (overlapping the score), so hide it until they're dismissed.
          In shop mode the same counter docks top-centre. */}
      {view !== "settings" && !duePrompt && !recap && (
        <>
          <PointsCounter ref={counterRef} total={points} docked={shopOpen} />
          <FlyingPoints flyers={flyers} getTarget={counterTarget} onLand={landFlyer} />
        </>
      )}
      <Poof burst={poof} />

      <AnimatePresence>
        {recap && <PeriodRecapCard key="recap" recap={recap} onClose={() => setRecap(null)} />}
      </AnimatePresence>

      {/* Screen-off wind-down nudge — mounted above the views so it pressures in every place, driven by
          the same effective clock (a pinned debug time freezes it for previewing). Self-gates on its
          own `enabled` flag. */}
      {settings && (
        <WindDownOverlay now={debugNow ?? realNow} pinned={debugNow !== null} settings={settings} />
      )}

      {/* Points-formula rebalance confirm — over the soft scrim, above the views. */}
      {formulaChange && (
        <RebalanceConfirm
          preview={formulaChange.preview}
          onYes={() => applyFormulaChange(true)}
          onNo={() => applyFormulaChange(false)}
          onCancel={() => setFormulaChange(null)}
        />
      )}

      <div className="shell">
        <header className="top">
          <div className="date">
            <div className="date-num">
              {today.toLocaleDateString(undefined, { weekday: "long" })}
            </div>
            <div className="date-day">
              {today.toLocaleDateString(undefined, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </div>
          </div>

          {/* Debug clock is pinned — show a persistent badge (in every view) with the pretend time
              and a one-click exit back to the real/browser clock. Only rendered while pinned. */}
          {debugNow && (
            <button
              type="button"
              className="debug-badge"
              onClick={() => setDebugClock(null)}
              title="Exit debug — go back to the real time"
            >
              <span className="debug-badge-dot" />
              Debug time · {today.toLocaleString(undefined, {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
              <span className="debug-badge-exit">Exit</span>
            </button>
          )}
        </header>

        <main className={shopOpen ? "shop-open" : undefined}>
          {loading ? (
            <p className="empty">Loading…</p>
          ) : view === "settings" && settings ? (
            <SettingsView
              settings={settings}
              onSave={saveSettings}
              onApplyFormula={requestFormulaChange}
              streaks={streaks}
              onBackfillStreak={backfillStreak}
              onReset={resetBoard}
              onResetKeepBoard={resetKeepBoard}
              debugNow={debugNow}
              realNow={realNow}
              onSetDebugClock={setDebugClock}
            />
          ) : (
            <BoardClockProvider value={{ now: debugNow ?? realNow, settings: settings ?? DEFAULT_SETTINGS }}>
            <CanvasSettingsProvider value={config.settings}>
              <AnimatePresence>
                {duePrompt && status && (
                  <PeriodPrompt
                    key={duePrompt}
                    kind={duePrompt}
                    periodKey={status[duePrompt].openKey ?? status[duePrompt].currentKey}
                    isFirst={status[duePrompt].openKey === null}
                    onConfirm={() => rollPeriod(duePrompt)}
                    onDismiss={() => setDismissed((prev) => new Set(prev).add(duePrompt))}
                  />
                )}
              </AnimatePresence>
              <CardCanvas
                name="board"
                cards={sections}
                layouts={config.layouts}
                onLayoutChange={setCardLayout}
                onResetLayouts={resetLayouts}
                settings={config.settings}
                onSettingsChange={setSettings}
                renderCard={(section, frame) => (
                  <SectionCard
                    key={section.id}
                    section={section}
                    tasks={tasks.filter((t) => t.sectionId === section.id)}
                    groups={groups.filter((g) => g.sectionId === section.id)}
                    streaks={streaks.filter((s) => s.sectionId === section.id)}
                    allTasks={tasks}
                    flyingTaskIds={flyingTaskIds}
                    frame={frame}
                    onAddTask={(payload) => addTask(section.id, payload)}
                    onSetLevel={setLevel}
                    onRemoveTask={removeTask}
                    onEditTask={editTask}
                    onReorderItems={(orderedIds) => reorderItems(section.id, orderedIds)}
                    onAddGroup={(taskIds) => addGroup(section.id, taskIds)}
                    onExtendGroup={extendGroup}
                    onEjectFromGroup={ejectFromGroup}
                    onEditGroup={editGroup}
                    onRemoveGroup={removeGroup}
                    onAddStreak={(payload) => addStreak(section.id, payload)}
                    onEditStreak={editStreak}
                    onRemoveStreak={removeStreak}
                    onReorderStreaks={(ordered) => reorderStreaks(section.id, ordered)}
                    onRecolor={recolorSection}
                    prefs={config.tabPrefs[section.id]}
                    onPrefsChange={(patch) => setTabPref(section.id, patch)}
                    pinnedSorts={config.pinnedSorts}
                    onTogglePin={togglePinnedSort}
                  />
                )}
              />
              {/* Shop mode overlays the same board frame; the board stays mounted beneath (hidden) so
                  its camera and card state survive the round-trip. */}
              <AnimatePresence>
                {shopOpen && (
                  <ShopView key="shop" points={points} shop={shopState} local={local} onBuy={buyReward} />
                )}
              </AnimatePresence>
            </CanvasSettingsProvider>
            </BoardClockProvider>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
