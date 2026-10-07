import {
  BoosterHand as BoosterHandSchema,
  BoosterStatus as BoosterStatusSchema,
  BountyStatus as BountyStatusSchema,
  BountyStopped as BountyStoppedSchema,
  DebugClockState as DebugClockStateSchema,
  DEFAULT_SETTINGS,
  formatPercent,
  type StatusFields,
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
import { groupsApi, withGathered, withMembership, withOrder, withoutGroup, withTrailing } from "./listOps";
import { CanvasSettingsProvider } from "./useCanvasSettings";
import FlyingPoints, { type Flyer, type FlyOrigin, type Point } from "./FlyingPoints";
import type { FlyerTier } from "./flyerTiers";
import { PeriodPrompt } from "./PeriodClose";
import { skippedSince } from "./periodLabels";
import { PeriodRecapCard } from "./Recap";
import { BountyReveal } from "./BountyReveal";
import { BoosterReveal } from "./BoosterReveal";
import PointsCounter, { type PointsCounterHandle } from "./PointsCounter";
import Poof, { type PoofBurst } from "./Poof";
import RebalanceConfirm from "./RebalanceConfirm";
import SectionCard from "./SectionCard";
import SettingsView from "./SettingsView";
import ShopView from "./ShopView";
import type { StreakPayload } from "./StreakForm";
import WindDownOverlay from "./WindDownOverlay";
import { finishFx, thawFx } from "./freezeFx";
import { behaviorOf, doneFromPieces, frostFill, frostShare, isRetired, modifiersOf, onWholeTask, payout, releasedFrom, saleOn, statusChange, taskPointValue, wholeWorth } from "./types";
import type { BoosterHand, BountyReel, BountyStatus, BountyStopped, FormulaPreview, Group, PeriodRecap, PeriodStatus, PointsFormula, Reward, Section, Settings, StreakView, Task, TaskSchedule, TaskStatus, TaskType, TierDef } from "./types";
import { BoardClockProvider } from "./useBoardClock";
import { useLocalConfig } from "./useLocalConfig";
import { useShop } from "./useShop";
import { uid } from "./uid";
import { useSuppressPasswordManagers } from "./useSuppressPasswordManagers";

const byOrder = (a: Task, b: Task) => (a.order ?? 0) - (b.order ?? 0);
// A reel dealt by a win is shown once the win's points have landed, after the counter's count-up (ms).
const WIN_REVEAL_SETTLE_MS = 700;
// A Booster hand with a pick still to make (else null).
const pickLeft = (hand: BoosterHand | null) => (hand && hand.picked.length < hand.picks ? hand : null);

function computeTotalPoints(tasks: Task[]): number {
  return tasks.reduce((sum, t) => sum + taskPointValue(t), 0);
}

function App() {
  useSuppressPasswordManagers();
  // Device-local view config (layouts, canvas settings, tab prefs) — one store shared by both canvases.
  const local = useLocalConfig();
  const { config, setCardLayout, setSettings, setTabPref, resetLayouts } = local;
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
  // The open week's Bounties still to win, its reel and the rerolls left: the row menu's Reroll.
  const [bountyStatus, setBountyStatus] = useState<BountyStatus | null>(null);
  // A reel to swing mid-week (a win dealt one for another Bounty, a row's Reroll, or the board was left
  // before the week's was swung), shown over the board.
  const [reveal, setReveal] = useState<BountyReel | null>(null);
  // One dealt by a win, waiting for that win's celebration to land before it's shown.
  const [revealNext, setRevealNext] = useState<BountyReel | null>(null);
  // This week's Booster hand when a pick is still to be made (the board was left before the recap's pick):
  // dealt again over the board.
  const [boosterLeft, setBoosterLeft] = useState<BoosterHand | null>(null);
  // Booster rerolls bought in the shop and not yet used: a Booster's menu offers one while any are left.
  const [boosterRerolls, setBoosterRerolls] = useState(0);
  // Whether the owner put off ending the day this session ("Not yet") — re-offered on the next load.
  const [dayDeferred, setDayDeferred] = useState(false);
  const [view, setView] = useState<AppView>("board");
  // The shop is a mode of the board's place, not a place of its own: same canvas, tabs poofed away.
  const shopOpen = view === "shop";
  const [poof, setPoof] = useState<PoofBurst | null>(null);
  const [loading, setLoading] = useState(true);
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const counterRef = useRef<PointsCounterHandle>(null);

  // A reel dealt by a win is shown once nothing is flying to the counter any more (and the count-up has had
  // its moment), so it never cuts the win's own celebration short.
  useEffect(() => {
    if (!revealNext || flyers.length > 0) return;
    const timer = window.setTimeout(() => {
      setReveal(revealNext);
      setRevealNext(null);
    }, WIN_REVEAL_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [revealNext, flyers.length]);

  useEffect(() => {
    Promise.all([
      fetch("/api/sections").then((res) => res.json()),
      fetch("/api/tasks").then((res) => res.json()),
      fetch("/api/groups").then((res) => res.json()),
      fetch("/api/streaks").then((res) => res.json()),
      fetch("/api/settings").then((res) => res.json()),
      fetch("/api/periods/status").then((res) => res.json()),
      fetch("/api/debug/clock").then((res) => res.json()),
      fetch("/api/bounty").then((res) => res.json()),
      fetch("/api/booster").then((res) => res.json()),
    ])
      // Validate the API's responses at the trust boundary rather than casting blindly — a shape
      // drift or a bad payload fails loudly here instead of surfacing as a mystery render bug.
      .then(([sectionsData, tasksData, groupsData, streaksData, settingsData, statusData, clockData, bountyData, boosterData]) => {
        setSections(SectionSchema.array().parse(sectionsData));
        setTasks(TaskSchema.array().parse(tasksData));
        setGroups(GroupSchema.array().parse(groupsData));
        setStreaks(StreakViewSchema.array().parse(streaksData));
        setSettingsState(SettingsSchema.parse(settingsData));
        setStatus(PeriodStatusSchema.parse(statusData));
        const clock = DebugClockStateSchema.parse(clockData);
        setDebugNow(clock.now);
        setRealNow(clock.real);
        const bounty = BountyStatusSchema.parse(bountyData);
        setBountyStatus(bounty);
        setReveal(bounty.reel);
        takeBoosterStatus(boosterData);
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

  // Whether to ask if the day has ended. Only the day is ever asked about — its week ends with it (the
  // server's follow-up once the week is over).
  const askDay = !!status?.day.due && !dayDeferred;
  // A reel to swing and a Booster pick left over are shown once nothing else is up — never before a day that
  // may end their week — the reel first, as in the recap.
  const revealShown = !!reveal && !askDay && !recap;
  const boosterShown = !!boosterLeft && !askDay && !recap && !reveal;

  function refreshStatus() {
    fetch("/api/periods/status")
      .then((res) => res.json())
      .then((data) => setStatus(PeriodStatusSchema.parse(data)));
  }

  // The board only takes the new day (and week) once its recaps close — so the new Bounties aren't given
  // away before their reels land. Closing the last recap resolves this.
  const recapClosedRef = useRef<() => void>(undefined);
  // The recaps still to show after the one up: a day that ended its week queues the week's.
  const recapQueueRef = useRef<PeriodRecap[]>([]);

  // End the day: the server closes it (snapshotting live task state), unchecks the daily tabs (banking
  // their points) and opens today — and when the week was over too, the same for the week — returning
  // the recaps and the recomputed streaks. The day's recap shows, then the week's; a first start (no day
  // was open — a fresh/reset board) has nothing to recap.
  function endDay() {
    const wasFirst = status?.day.openKey === null;
    // The prompt goes as soon as it's answered — the real status only follows once the board reads back.
    setStatus((s) => (s ? { ...s, day: { ...s.day, due: false }, week: { ...s.week, due: false } } : s));
    fetch("/api/periods/roll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "day" }),
    })
      .then((res) => res.json())
      .then(async (data) => {
        const { recap: r, week: w, streaks: s } = data as { recap: unknown; week?: unknown; streaks: unknown };
        const recaps = [...(wasFirst ? [] : [PeriodRecapSchema.parse(r)]), ...(w ? [PeriodRecapSchema.parse(w)] : [])];
        const nextStreaks = StreakViewSchema.array().parse(s);
        if (recaps.length > 0) {
          const closed = new Promise<void>((resolve) => (recapClosedRef.current = resolve));
          recapQueueRef.current = recaps.slice(1);
          setRecap(recaps[0]);
          await closed;
        }
        // Read back once it's closed: the recap's reels rolled the week's Bounties, and a pick made the Booster.
        return Promise.all([
          nextStreaks,
          fetch("/api/tasks").then((res) => res.json()),
          fetch("/api/periods/status").then((res) => res.json()),
          refreshBounty(),
          fetch("/api/booster").then((res) => res.json()),
        ]);
      })
      // The unchecked tasks and the banked points land in the same render, so the counter never dips.
      .then(([nextStreaks, tasksData, statusData, bounty, boosterData]) => {
        setStreaks(nextStreaks);
        setTasks(TaskSchema.array().parse(tasksData));
        setStatus(PeriodStatusSchema.parse(statusData));
        // A reel the recap left unswung is shown over the board.
        setReveal(bounty.reel);
        takeBoosterStatus(boosterData);
      });
  }

  function closeRecap() {
    const next = recapQueueRef.current.shift();
    if (next) {
      setRecap(next);
      return;
    }
    setRecap(null);
    recapClosedRef.current?.();
    recapClosedRef.current = undefined;
  }

  function refreshBounty() {
    return fetch("/api/bounty")
      .then((res) => res.json())
      .then((data) => {
        const next = BountyStatusSchema.parse(data);
        setBountyStatus(next);
        return next;
      });
  }

  // Roll a Bounty on the spot this week's reel stopped on; that Bounty, with the week's as they now stand
  // (null when the server refused).
  function postBountyRoll(spot: number): Promise<BountyStopped | null> {
    return fetch("/api/bounty/roll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spot }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (data ? BountyStoppedSchema.parse(data) : null));
  }

  // Reroll one of this week's Bounties: it's given up, and the week's Bounties come back with its new reel
  // (null when the server refused).
  function postReroll(taskId: string): Promise<BountyStatus | null> {
    return fetch("/api/bounty/reroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (data ? BountyStatusSchema.parse(data) : null));
  }

  // From the recap: it holds the week's Bounties as a roll or a reroll leaves them, so its page reads right
  // when it's flipped back to (the board reads them back on close).
  function inRecap<T extends BountyStatus>(next: T | null): T | null {
    if (next) setRecap((r) => (r ? { ...r, bounty: next } : r));
    return next;
  }

  // Take a card of this week's Booster hand; the hand with it turned over (null when the server refused).
  function postBoosterPick(card: number): Promise<BoosterHand | null> {
    return fetch("/api/booster/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (data ? BoosterHandSchema.parse(data) : null));
  }

  // From the recap: the card's turned over, and the recap holds the hand as it now is.
  function pickInRecap(card: number) {
    return postBoosterPick(card).then((hand) => {
      if (hand) setRecap((r) => (r ? { ...r, booster: hand } : r));
      return hand;
    });
  }

  // From a pick left over (BoosterReveal): closed, the board reads back its Booster.
  function closeBoosterLeft() {
    setBoosterLeft(null);
    reloadTasks();
  }

  // The open week's Booster hand, when a pick is left to make, and the rerolls left.
  function takeBoosterStatus(data: unknown) {
    const booster = BoosterStatusSchema.parse(data);
    setBoosterLeft(pickLeft(booster.hand));
    setBoosterRerolls(booster.rerollsLeft);
  }

  function refreshBooster() {
    return fetch("/api/booster")
      .then((res) => res.json())
      .then(takeBoosterStatus);
  }

  // From a Booster's row: it's given up, and the new hand is dealt over the board to pick one card from.
  function rerollBooster(taskId: string) {
    fetch("/api/booster/reroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setBoosterLeft(BoosterHandSchema.parse(data));
        setBoosterRerolls((n) => Math.max(0, n - 1));
      });
  }

  // From a Bounty's row: it's given up, and its new reel is shown over the board to swing.
  function rerollRevealed(taskId: string) {
    postReroll(taskId).then((next) => {
      if (!next) return;
      setBountyStatus(next);
      setReveal(next.reel);
    });
  }

  // The reveal closed: the board reads back its Bounties (the new one stamped, a rerolled one gone).
  function closeReveal() {
    setReveal(null);
    reloadTasks();
    refreshBounty();
  }

  // A win that dealt a reel for another Bounty (Settings' rollOnWin): it waits (revealNext) for the win's
  // celebration.
  function revealRolledAfterWin() {
    refreshBounty().then((next) => setRevealNext(next.reel));
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

  function spawnFlyer(taskId: string, amount: number, origin?: FlyOrigin, finale = false) {
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
        finale,
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

  // At the price the owner was shown. An item lands once the server has it: the rerolls it gives are
  // read back for the Bounty's and the Booster's menus.
  function buyReward(reward: Reward, price: number) {
    shopState.buy(reward, price).then(() => {
      if (!reward.item) return;
      refreshBounty();
      refreshBooster();
    });
    counterRef.current?.spend(price);
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
    payload: { type: TaskType; text: string; points?: number; estimate?: string; estimateMinutes?: number; estimateEffort?: string; pointsSource?: "builder" | "manual"; description?: string; tiers?: TierDef[]; count?: number; schedule?: TaskSchedule },
  ) {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionId, ...payload }),
    });
    const task = TaskSchema.parse(await res.json());
    // The server lands a new task ahead of the tab's retired one-time tasks; mirror that locally.
    setTasks((prev) => withTrailing([...prev, task], sectionId, isRetired));
  }

  // Duplicate waits for the server (it mints the copy's id), then mirrors where the server put it: right
  // after its source, in its group (the copy arrives with its groupId), ahead of any retired tasks.
  // A piece's copy lands the same way among its task's pieces (and reopens that task if it was finished).
  async function duplicateTask(id: string) {
    const res = await fetch(`/api/tasks/${id}/duplicate`, { method: "POST" });
    const copy = TaskSchema.parse(await res.json());
    // A broken-down task's copy came with copies of its pieces, which only the server knows: read them back.
    if (tasks.some((t) => t.parentId === id)) return reloadTasks();
    setTasks((prev) => {
      const order = prev
        .filter((t) => t.sectionId === copy.sectionId && t.parentId === copy.parentId)
        .sort(byOrder)
        .map((t) => t.id);
      order.splice(order.indexOf(id) + 1, 0, copy.id);
      const next = withOrder([...prev, copy], order);
      return copy.parentId ? settleParents(next, [copy.parentId]) : withTrailing(next, copy.sectionId, isRetired);
    });
  }

  // The whole board's tasks read back from the server, for the few changes whose result only it knows.
  function reloadTasks() {
    return fetch("/api/tasks")
      .then((res) => res.json())
      .then((data) => setTasks(TaskSchema.array().parse(data)));
  }

  // Break down waits for the server like Duplicate (it mints the pieces, and moves the task's points into
  // them), then adopts the task's new points and its new pieces.
  async function breakDown(task: Task, texts: string[]) {
    const res = await fetch(`/api/tasks/${task.id}/pieces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    });
    if (!res.ok) return;
    const [parent, ...pieces] = TaskSchema.array().parse(await res.json());
    setTasks((prev) => {
      const known = new Set(prev.map((t) => t.id));
      return [
        ...prev.map((t) => (t.id === parent.id ? { ...t, points: parent.points, pointsSource: parent.pointsSource } : t)),
        ...pieces.filter((p) => !known.has(p.id)),
      ];
    });
  }

  // Tuck a task into another as its last piece, or take a piece out into its tab's list right after the
  // task it left — the placement the server folds (TaskParentSet), mirrored; either task then follows its
  // pieces. A refused move reads the board back.
  function setTaskParent(taskId: string, parentId: string | null) {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === taskId);
      if (!task) return prev;
      let next: Task[];
      if (parentId) {
        const last = prev.filter((t) => t.parentId === parentId).length;
        next = prev.map((t) => (t.id === taskId ? { ...t, parentId, groupId: undefined, order: last } : t));
      } else {
        const order = prev.filter((t) => t.sectionId === task.sectionId && !t.parentId).sort(byOrder).map((t) => t.id);
        const at = task.parentId ? order.indexOf(task.parentId) : -1;
        order.splice(at === -1 ? order.length : at + 1, 0, taskId);
        next = withOrder(prev.map((t) => (t.id === taskId ? { ...t, parentId: undefined } : t)), order);
        next = withTrailing(withGathered(next, task.sectionId), task.sectionId, isRetired);
      }
      return settleParents(next, [task.parentId, parentId]);
    });
    fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId }),
    }).then((res) => {
      if (!res.ok) reloadTasks();
    });
  }

  function reorderPieces(parentId: string, orderedIds: string[]) {
    setTasks((prev) => withOrder(prev, orderedIds));
    fetch(`/api/tasks/${parentId}/pieces/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
  }

  // Prune is optimistic like a tick. The server can refuse it (e.g. no day/week started yet), so a
  // refused write puts the task back as it was.
  function setPruned(task: Task, pruned: boolean) {
    const was = task.pruned;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, pruned } : t)));
    fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pruned }),
    }).then((res) => {
      if (!res.ok) setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, pruned: was } : t)));
    });
  }

  // The board's effective "now" as the server will stamp it (a pinned debug time wins), for the times an
  // optimistic update records before the server's reply lands.
  const stampNow = () => debugNow ?? new Date().toISOString();

  // Moving a task to a Status band is optimistic, through the same rule the server folds (statusChange) —
  // its wait (In progress pauses it) and a thaw bonus only In progress keeps move with it. The server can
  // refuse a blocker (the task it waits on is already done, say), so a refused write puts the task back; an
  // accepted one adopts the server's stamps.
  function setTaskStatus(task: Task, status: TaskStatus, why: { note?: string; taskId?: string } = {}) {
    const patchTask = (fields: StatusFields) => setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...fields } : t)));
    const statusFields = (t: Task): StatusFields => ({
      status: t.status,
      statusSince: t.statusSince,
      blocker: t.blocker,
      waitMs: t.waitMs,
      waitingSince: t.waitingSince,
      thawBonus: t.thawBonus,
    });
    const previous = statusFields(task);
    const blocker = status === "blocked" ? { ...(why.note ? { note: why.note } : {}), ...(why.taskId ? { taskId: why.taskId } : {}) } : undefined;
    patchTask(statusChange(task, status, blocker ?? {}, stampNow()));
    fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(blocker ? { blocker } : {}) }),
    }).then(async (res) => {
      if (!res.ok) return patchTask(previous);
      patchTask(statusFields(TaskSchema.parse(await res.json())));
    });
  }

  // What a completion of `task` would be paid at right now — its modifiers, as the server pays it (its
  // Bounty's and frost or its task's, Subzero) — read from `list`, the board as it will be. `paying` is for
  // its completion itself: a broken-down task's floor then counts what its pieces paid.
  function modifiersNow(task: Task, list: Task[], paying = false) {
    const parent = task.parentId ? list.find((t) => t.id === task.parentId) : undefined;
    const pieces = list.filter((t) => t.parentId === task.id);
    return modifiersOf(task, {
      settings: settings ?? DEFAULT_SETTINGS,
      section: sections.find((s) => s.id === task.sectionId),
      ...(parent ? { parent } : {}),
      hasPieces: pieces.length > 0,
      ...(paying ? { piecesPaid: pieces.reduce((sum, p) => sum + taskPointValue(p), 0) } : {}),
    });
  }

  // Freezing and thawing move a task (and its pieces) between its tab and the tab's Freezer — optimistic, the
  // server's fold mirrored: frozen, it leaves its group and its status, a thaw bonus goes, and its wait starts
  // again; thawed, it's started at the top of its tab, its wait paused, paid the thaw bonus if it has frost.
  // Then the board reads back (the server knows the order and the pieces for certain). Thawing lets the frost
  // out — an effect sized by how full it was — and the bonus flies to the counter.
  function setTaskFrozen(task: Task, frozen: boolean) {
    const home = sections.find((s) => s.id === task.sectionId);
    const to = frozen ? sections.find((s) => s.freezerFor === task.sectionId)?.id : home?.freezerFor;
    if (!to) return;
    const s = settings ?? DEFAULT_SETTINGS;
    const at = stampNow();
    const bonus = !frozen && frostShare(task, s) > 0 ? s.freezer.thawBonus : 0;
    const bracket = document.querySelector(`[data-task-id="${CSS.escape(task.id)}"] .points-prefix`)?.getBoundingClientRect();
    // All of it, pieces and all, as its bracket shows it.
    const worth = wholeWorth(task, tasks.filter((t) => t.parentId === task.id));
    const paidOnIce = payout(worth, modifiersNow(task, tasks));
    const moving = new Set([task.id, ...tasks.filter((t) => t.parentId === task.id).map((t) => t.id)]);
    setTasks((prev) => {
      const moved = prev.map((t) => {
        if (!moving.has(t.id)) return t;
        const base = { ...t, sectionId: to, tabSince: at, waitMs: 0 };
        if (frozen) return { ...base, groupId: undefined, status: undefined, statusSince: undefined, blocker: undefined, thawBonus: undefined, waitingSince: at };
        return t.id === task.id
          ? { ...base, status: "in-progress" as const, statusSince: at, waitingSince: undefined, thawBonus: bonus || undefined }
          : { ...base, waitingSince: undefined };
      });
      // Frozen, it's last on ice; thawed, first in its tab.
      const others = moved.filter((t) => t.sectionId === to && !t.parentId && t.id !== task.id).sort(byOrder).map((t) => t.id);
      return withOrder(moved, frozen ? [...others, task.id] : [task.id, ...others]);
    });
    fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frozen }),
    }).then(() => reloadTasks());
    if (frozen) return cancelFlyersFor(task.id);
    if (bonus > 0 && bracket) spawnFlyer(`thaw:${task.id}`, bonus, { rect: bracket, percents: [bonus] });
    const out = { ...task, sectionId: to };
    thawFx(
      task.id,
      frostFill(task, s),
      { frost: Math.round(worth * frostShare(task, s)), from: paidOnIce, to: payout(worth, modifiersNow(out, tasks)) },
      formatPercent,
    );
  }

  // Whatever waits on `taskId` goes back to its band once that task is done or deleted — the server's
  // fold rule (releaseDependents), mirrored so the waiting task moves in the same render.
  const releaseWaitingOn = (tasks: Task[], taskId: string): Task[] => {
    const at = stampNow();
    return tasks.map((t) => {
      const release = releasedFrom(t, taskId, at);
      return release ? { ...t, ...release } : t;
    });
  };

  // Streak counts are the server's to compute (from completion history), so any task change that
  // could move a linked streak means re-reading them. A full re-fetch is fine for a single-user
  // board; the server is the sole authority on the count.
  // ponytail: refetch all streaks rather than diffing which ones link this task — one small GET.
  function refreshStreaks() {
    fetch("/api/streaks")
      .then((res) => res.json())
      .then((data) => setStreaks(StreakViewSchema.array().parse(data)));
  }

  // One task's filled level set to `level`, and what follows from it: whatever waited on it is released
  // once it's done, and a one-time task that finishes leaves its group and trails its tab (the server's
  // retire rules, BoardStore.settleDoneChange).
  function withLevel(list: Task[], task: Task, level: number): Task[] {
    const b = behaviorOf(task);
    const patch = b.patchForLevel(task, level);
    const finishes = b.isDone({ ...task, ...patch });
    // Paid at its modifiers while any box is ticked — kept if one already was, as the server freezes them on
    // the first tick — and none once nothing is.
    const ticked = b.filled({ ...task, ...patch }) > 0;
    const paid = !ticked ? undefined : b.filled(task) > 0 ? task.paidWith : modifiersNow(task, list, true);
    const changed = list.map((t) => (t.id === task.id ? { ...t, ...patch, paidWith: paid?.length ? paid : undefined } : t));
    const next = finishes ? releaseWaitingOn(changed, task.id) : changed;
    if (!b.retiresWhenDone) return next;
    return withTrailing(finishes ? withMembership(next, [task.id], undefined) : next, task.sectionId, isRetired);
  }

  // A task with pieces is done once every piece is, and open again once one isn't — the server's
  // settleParent, mirrored; finishing or reopening it follows the same rules as a tick of its own box.
  function settleParents(list: Task[], ids: (string | null | undefined)[]): Task[] {
    return ids.reduce((next, id) => {
      const parent = id ? next.find((t) => t.id === id) : undefined;
      const done = parent ? doneFromPieces(next.filter((t) => t.parentId === parent.id)) : null;
      if (!parent || done === null || done === behaviorOf(parent).isDone(parent)) return next;
      return withLevel(next, parent, done ? behaviorOf(parent).boxes(parent) : 0);
    }, list);
  }

  // One handler for every task type: a click resolves to a target "filled level" (via the type's
  // behaviour), which maps to a field patch and a point delta. No branching on task.type here — a
  // checkbox is the 1-box case, a tier is level = index+1, a count is level = boxes ticked. A broken-down
  // task's box is all of its pieces at once (the server fans the tick out to them the same way), and the
  // tick that finishes a task's last piece celebrates the whole task.
  function setLevel(task: Task, level: number, origin?: FlyOrigin) {
    const patch = behaviorOf(task).patchForLevel(task, level);
    const pieces = tasks.filter((t) => t.parentId === task.id);
    const changes =
      pieces.length > 0
        ? pieces
            .map((p) => ({ task: p, level: level > 0 ? behaviorOf(p).boxes(p) : 0 }))
            .filter((c) => behaviorOf(c.task).filled(c.task) !== c.level)
        : [{ task, level }];
    // The task whose pieces this changes (it follows them).
    const parent = pieces.length > 0 ? task : tasks.find((t) => t.id === task.parentId);
    const apply = (list: Task[]) => settleParents(changes.reduce((l, c) => withLevel(l, c.task, c.level), list), [parent?.id]);
    setTasks(apply);
    const after = apply(tasks);
    const finished = (id: string | undefined) => {
      const was = tasks.find((t) => t.id === id);
      const now = after.find((t) => t.id === id);
      return !!was && !!now && !behaviorOf(was).isDone(was) && behaviorOf(now).isDone(now);
    };
    const wonBounty = (!!task.bounty && finished(task.id)) || (!!parent?.bounty && finished(parent.id));
    fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then(refreshStreaks) // reconcile linked streak counts once the server has applied the change
      .then(() => {
        if (wonBounty && settings?.bounty.rollOnWin) revealRolledAfterWin();
      });
    // What the tick won — the board's total after it, less before: its modifiers and a finished task's
    // own points included. Finishing a broken-down task, or winning a Bounty, is the bigger celebration.
    const delta = computeTotalPoints(after) - computeTotalPoints(tasks);
    const finale = finished(parent?.id) || wonBounty;
    // A flyer carries what was won, which can be more than the one bracket it leaves from (a broken-down
    // task's whole tick, a piece paid at its modifiers, a task finished along with its last piece).
    const modifiedTick = (after.find((t) => t.id === task.id)?.paidWith?.length ?? 0) > 0;
    const shown = origin && (pieces.length > 0 || finale || modifiedTick) ? { ...origin, percents: [delta] } : origin;
    // Finishing a task that froze cracks, shatters or brings the avalanche (by how full its frost was), and
    // winning a Bounty throws embers — played off its row while it's still there. A broken-down task's is
    // its whole finish (its last piece, or its own box), never a piece on the way.
    const whole = parent && finished(parent.id) ? parent : !task.parentId && finished(task.id) ? task : undefined;
    const fill = whole ? frostFill(whole, settings ?? DEFAULT_SETTINGS) : 0;
    if (delta > 0 && whole && (fill > 0 || wonBounty)) {
      // What the whole task paid, as its bracket says it — a broken-down one's pieces included.
      const done = after.find((t) => t.id === whole.id) ?? whole;
      const paid = payout(wholeWorth(done, after.filter((t) => t.parentId === done.id)), onWholeTask(done.paidWith ?? []));
      finishFx(whole.id, fill, wonBounty, formatPercent(paid));
    }
    if (delta > 0) spawnFlyer(task.id, delta, shown, finale);
    else changes.forEach((c) => cancelFlyersFor(c.task.id));
  }

  // A broken-down task goes with its pieces; a deleted piece may leave its task with only finished ones.
  function removeTask(id: string) {
    const task = tasks.find((t) => t.id === id);
    const gone = new Set([id, ...tasks.filter((t) => t.parentId === id).map((t) => t.id)]);
    gone.forEach(cancelFlyersFor);
    setTasks((prev) =>
      settleParents(
        [...gone].reduce((list, goneId) => releaseWaitingOn(list, goneId), prev.filter((t) => !gone.has(t.id))),
        [task?.parentId],
      ),
    );
    fetch(`/api/tasks/${id}`, { method: "DELETE" });
  }

  function editTask(id: string, patch: { text?: string; points?: number; estimateMinutes?: number | null; estimateEffort?: string | null; pointsSource?: "builder" | "manual"; description?: string | null; tiers?: Task["tiers"]; count?: number; progress?: number; schedule?: TaskSchedule }) {
    // Server takes null to clear description/estimate; the local Task shape uses undefined for "none".
    // Only touch a field when the patch carries it (absent = leave as-is).
    const { description: desc, estimateMinutes: est, estimateEffort: eff, ...rest } = patch;
    const local: Partial<Task> = { ...rest };
    if (desc !== undefined) local.description = desc ?? undefined;
    if (est !== undefined) local.estimateMinutes = est ?? undefined;
    if (eff !== undefined) local.estimateEffort = eff ?? undefined;
    // An all-unscheduled array means "no schedule" locally (mirrors the server's normalisation).
    if (Array.isArray(local.schedule) && !local.schedule.some(Boolean)) local.schedule = undefined;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...local } : t)));
    fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  // Reorder a section's tasks. `orderedIds` is the full new task sequence; we write each task's new index
  // back to `order`, then persist. Groups are gathered into one run each, as the server's fold does — a
  // Status band's reorder only sees its own tasks, so it can't always keep another band's out of a run.
  function reorderItems(sectionId: string, orderedIds: string[]) {
    setTasks((prev) => withGathered(withOrder(prev, orderedIds), sectionId));
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
    setTasks((prev) => withGathered(withMembership(prev, taskIds, group.id), sectionId));
  }

  function ejectFromGroup(taskId: string, groupId: string, newOrder: string[]) {
    setTasks((prev) => withMembership(prev, [taskId], undefined));
    const sectionId = tasks.find((t) => t.id === taskId)?.sectionId;
    if (sectionId) reorderItems(sectionId, newOrder);
    groupsApi.removeMembers(groupId, [taskId]);
  }

  function extendGroup(groupId: string, additionalTaskIds: string[]) {
    const sectionId = groups.find((g) => g.id === groupId)?.sectionId;
    setTasks((prev) => {
      const next = withMembership(prev, additionalTaskIds, groupId);
      return sectionId ? withGathered(next, sectionId) : next;
    });
    groupsApi.addMembers(groupId, additionalTaskIds);
  }

  function editGroup(id: string, label: string) {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, label } : g)));
    groupsApi.relabel(id, label);
  }

  // Deleting a group ungroups its members — clear their groupId locally, drop the group. Applying
  // withoutGroup to both lists is harmless on whichever one doesn't own this group's members.
  function removeGroup(id: string) {
    setTasks((prev) => withoutGroup(prev, id));
    setStreaks((prev) => withoutGroup(prev, id));
    setGroups((prev) => prev.filter((g) => g.id !== id));
    groupsApi.remove(id);
  }

  // Streak groups — the same shared list plumbing (listOps) as task groups, over this board's
  // streaks (see SectionCard/StreakItem, now built on the same ItemList/ItemRow base as tasks).
  async function addStreakGroup(sectionId: string, streakIds: string[]) {
    const group = await groupsApi.create(sectionId, streakIds);
    setGroups((prev) => [...prev, group]);
    setStreaks((prev) => withMembership(prev, streakIds, group.id));
  }

  function ejectStreakFromGroup(streakId: string, groupId: string, newOrder: string[]) {
    setStreaks((prev) => withMembership(prev, [streakId], undefined));
    const sectionId = streaks.find((s) => s.id === streakId)?.sectionId;
    if (sectionId) reorderStreakItems(sectionId, newOrder);
    groupsApi.removeMembers(groupId, [streakId]);
  }

  function extendStreakGroup(groupId: string, additionalStreakIds: string[]) {
    setStreaks((prev) => withMembership(prev, additionalStreakIds, groupId));
    groupsApi.addMembers(groupId, additionalStreakIds);
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

  // Reorder a streaks tab's streaks — the streak counterpart of reorderItems (full new order; group
  // members kept contiguous by ItemList's block).
  function reorderStreakItems(sectionId: string, orderedIds: string[]) {
    setStreaks((prev) => withOrder(prev, orderedIds));
    fetch("/api/streaks/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionId, orderedIds }),
    });
  }

  return (
    <div className="page">
      <AppNav view={view} onChange={changeView} />

      {/* The HUD floats over the whole screen; while a period prompt or recap overlay is up it would
          sit on top of that focus surface (overlapping the score), so hide it until they're dismissed.
          In shop mode the same counter docks top-centre. */}
      {view !== "settings" && !askDay && !recap && !revealShown && !boosterShown && (
        <>
          <PointsCounter ref={counterRef} total={points} docked={shopOpen} />
          <FlyingPoints flyers={flyers} getTarget={counterTarget} onLand={landFlyer} />
        </>
      )}
      <Poof burst={poof} />

      <AnimatePresence>
        {recap && (
          <PeriodRecapCard
            key={`${recap.kind}-${recap.periodKey}`}
            recap={recap}
            onRollBounty={(spot) => postBountyRoll(spot).then(inRecap)}
            onRerollBounty={(taskId) => postReroll(taskId).then(inRecap)}
            onPickBooster={pickInRecap}
            onClose={closeRecap}
          />
        )}
        {revealShown && reveal && (
          <BountyReveal key="reveal" reel={reveal} rerollsLeft={bountyStatus?.rerollsLeft ?? 0} onRoll={postBountyRoll} onReroll={postReroll} onClose={closeReveal} />
        )}
        {boosterShown && boosterLeft && <BoosterReveal key="booster" hand={boosterLeft} onPick={postBoosterPick} onClose={closeBoosterLeft} />}
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
          sections={sections}
          tasks={tasks}
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
              layouts={config.layouts}
              saleRunning={saleOn(debugNow ?? realNow, settings, { openDay: status?.day.openKey ?? undefined, startedEarly: shopState.shop.saleStarted })}
              onStartSale={shopState.startSale}
            />
          ) : (
            <BoardClockProvider
              value={{ now: debugNow ?? realNow, settings: settings ?? DEFAULT_SETTINGS, openDay: status?.day.openKey ?? undefined }}
            >
            <CanvasSettingsProvider value={config.settings}>
              <AnimatePresence>
                {askDay && status && (
                  <PeriodPrompt
                    key="day"
                    dayKey={status.day.openKey ?? status.day.currentKey}
                    isFirst={status.day.openKey === null}
                    skipped={skippedSince(status)}
                    onConfirm={endDay}
                    onDismiss={() => setDayDeferred(true)}
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
                    allSections={sections}
                    allStreaks={streaks}
                    flyingTaskIds={flyingTaskIds}
                    frame={frame}
                    onAddTask={(payload) => addTask(section.id, payload)}
                    onSetLevel={setLevel}
                    onRemoveTask={removeTask}
                    onEditTask={editTask}
                    onDuplicateTask={duplicateTask}
                    onSetPruned={setPruned}
                    onSetStatus={setTaskStatus}
                    onSetFrozen={setTaskFrozen}
                    onBreakDown={breakDown}
                    onSetParent={setTaskParent}
                    rerollsLeft={bountyStatus?.rerollsLeft ?? 0}
                    onRerollBounty={rerollRevealed}
                    boosterRerollsLeft={boosterRerolls}
                    onRerollBooster={rerollBooster}
                    onReorderPieces={reorderPieces}
                    onReorderItems={(orderedIds) => reorderItems(section.id, orderedIds)}
                    onAddGroup={(taskIds) => addGroup(section.id, taskIds)}
                    onExtendGroup={extendGroup}
                    onEjectFromGroup={ejectFromGroup}
                    onEditGroup={editGroup}
                    onRemoveGroup={removeGroup}
                    onAddStreak={(payload) => addStreak(section.id, payload)}
                    onEditStreak={editStreak}
                    onRemoveStreak={removeStreak}
                    onReorderStreakItems={(orderedIds) => reorderStreakItems(section.id, orderedIds)}
                    onAddStreakGroup={(streakIds) => addStreakGroup(section.id, streakIds)}
                    onExtendStreakGroup={extendStreakGroup}
                    onEjectStreakFromGroup={ejectStreakFromGroup}
                    onRecolor={recolorSection}
                    prefs={config.tabPrefs[section.id]}
                    onPrefsChange={(patch) => setTabPref(section.id, patch)}
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
