import { behaviorOf, effortRank } from "@board/contracts";
import {
  AgeIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BagIcon,
  CircleCheckIcon,
  CircleIcon,
  DumbbellIcon,
  FlameIcon,
  GroupBracketIcon,
  HourglassIcon,
  InProgressIcon,
  MeterIcon,
  PencilIcon,
  PlusIcon,
  PriorityIcon,
  ScissorsIcon,
  SnowflakeIcon,
  SparkleIcon,
  TallyIcon,
  ThawIcon,
  TimerIcon,
  ZapIcon,
} from "./Icons";
import { catalog, offer, type DisplayOption, type ListPart, type SortOption, type TabOffer } from "./TabControls";
import { PRIORITY_LOOKS } from "./taskPriority";
import { behaviorOfType, isBoxLocked, PRIORITIES, priorityOf, waitedMs } from "./types";
import type { Reward, Section, Settings, StreakView, Task, TaskPriority } from "./types";

// What every tab's Sort and Display menus offer — the one place to read it. Each kind of item has a catalog:
// every sort and display toggle its tabs can use, each written once (a sort's logic is its `compare`). Each tab
// then picks from it what makes sense there: pinned up front if it's likely used, unpinned (under "Show
// more") if it's only sometimes useful, left out if it means nothing there — and renamed where the catalog's
// words don't fit (the Freezer's Age is "Days frozen"). A tab never re-implements a sort or a toggle.

// The toggles every kind of tab has.
// The tab's "+" add button (CardAdd): shown, or hidden until the pointer is on its row.
export const ADD_BUTTON_KEY = "add";
const addButton = (noun: string): DisplayOption => ({ key: ADD_BUTTON_KEY, label: `Add ${noun} button`, icon: PlusIcon });
// The tab's groups: off, they don't show at all (the list is flat) and no group can be made — no group handle,
// no dragging a row into one. On by default; a to-do list and its Freezer rarely want them.
export const GROUPING_KEY = "grouping";
const grouping: DisplayOption = { key: GROUPING_KEY, label: "Grouping", icon: GroupBracketIcon, defaultOn: true };

const pinned = { pinned: true };

// ---- Tasks ----

/** What the task sorts need to know: the board's clock and settings, and its open day (for schedule locks). */
export interface TaskSortContext {
  now: string;
  settings: Settings;
  openDay?: string;
}

// Read through the task's behaviour, so no sort branches on its type.
const isDone = (task: Task): boolean => behaviorOf(task).isDone(task);
const maxValue = (task: Task): number => behaviorOf(task).maxValue(task);
// A checkbox task's estimated minutes (a tiered one keeps its estimate per tier).
const estMinutes = (task: Task): number | undefined => task.estimateMinutes;
// A task's effort level as its place on the scale, lightest first: its estimate's, or a tiered task's hardest
// timed tier's. Undefined for a task never given an estimate, so never given an effort.
const effortOf = (task: Task, ctx: TaskSortContext): number | undefined => {
  const formula = ctx.settings.pointsFormula;
  const ranks =
    task.estimateMinutes != null
      ? [effortRank(formula, task.estimateEffort)]
      : (task.tiers ?? []).filter((t) => t.minutes != null).map((t) => effortRank(formula, t.effort));
  const rank = Math.max(-1, ...ranks);
  return rank >= 0 ? rank : undefined;
};
// Whether the box you'd act on next is schedule-locked — its time hasn't come, so you can't knock it out now.
const isLocked = (task: Task, ctx: TaskSortContext): boolean => {
  const entry = task.schedule?.[behaviorOf(task).filled(task)];
  return !!entry && isBoxLocked(entry, ctx.now, ctx.settings, ctx.openDay);
};

// One priority's part of a list: its tasks, in the list's order, under its word in its colour.
const priorityPart = (priority: TaskPriority, tasks: readonly Task[]): ListPart<Task> => ({
  key: priority,
  label: PRIORITY_LOOKS[priority].label,
  color: PRIORITY_LOOKS[priority].color,
  items: tasks.filter((t) => priorityOf(t) === priority),
});
// High set apart from everything else. With no High task there's nothing to set apart, so the rest gets no
// header.
const highApart = (tasks: readonly Task[]): ListPart<Task>[] => {
  const high = priorityPart("high", tasks);
  const rest = tasks.filter((t) => priorityOf(t) !== "high");
  return high.items.length > 0 ? [high, { key: "rest", label: "Tasks", items: rest }] : [{ key: "rest", items: rest }];
};

export const TASK_SORTS = catalog<SortOption<Task, TaskSortContext>>()({
  manual: { key: "manual", label: "Manual", icon: SparkleIcon },
  // By priority: a part each, under its header, in the tab's own order inside it — so rows still drag there.
  priorityHigh: { key: "priority-high", label: "Priority: High only", icon: PriorityIcon, parts: () => highApart },
  priorityAll: {
    key: "priority-all",
    label: "Priority: High, Medium, Low",
    icon: PriorityIcon,
    parts: () => (tasks) => PRIORITIES.map((priority) => priorityPart(priority, tasks)),
  },
  // Shortest doable first, in bands: doable and timed (shortest first), schedule-locked (not yet doable),
  // untimed, then done at the very bottom.
  quick: {
    key: "quick",
    label: "Get done quick",
    icon: ZapIcon,
    compare: (ctx) => {
      const rank = (t: Task) => (isDone(t) ? 3 : isLocked(t, ctx) ? 1 : estMinutes(t) == null ? 2 : 0);
      return (a, b) => rank(a) - rank(b) || (estMinutes(a) ?? Infinity) - (estMinutes(b) ?? Infinity);
    },
  },
  pointsDesc: { key: "points-desc", label: "Points: high to low", icon: ArrowDownIcon, compare: () => (a, b) => maxValue(b) - maxValue(a) },
  pointsAsc: { key: "points-asc", label: "Points: low to high", icon: ArrowUpIcon, compare: () => (a, b) => maxValue(a) - maxValue(b) },
  incompleteFirst: { key: "status-incomplete", label: "Incomplete first", icon: CircleIcon, compare: () => (a, b) => Number(isDone(a)) - Number(isDone(b)) },
  completeFirst: { key: "status-complete", label: "Completed first", icon: CircleCheckIcon, compare: () => (a, b) => Number(isDone(b)) - Number(isDone(a)) },
  // Tasks without an estimate sink to the bottom either way.
  timeAsc: {
    key: "time-asc",
    label: "Time: short to long",
    icon: TimerIcon,
    compare: () => (a, b) => (estMinutes(a) ?? Infinity) - (estMinutes(b) ?? Infinity),
  },
  timeDesc: { key: "time-desc", label: "Time: long to short", icon: TimerIcon, compare: () => (a, b) => (estMinutes(b) ?? -1) - (estMinutes(a) ?? -1) },
  // Tasks without an effort sink to the bottom either way, like the time sorts.
  effortAsc: {
    key: "effort-asc",
    label: "Effort: lightest first",
    icon: DumbbellIcon,
    compare: (ctx) => (a, b) => (effortOf(a, ctx) ?? Infinity) - (effortOf(b, ctx) ?? Infinity),
  },
  effortDesc: {
    key: "effort-desc",
    label: "Effort: hardest first",
    icon: DumbbellIcon,
    compare: (ctx) => (a, b) => (effortOf(b, ctx) ?? -1) - (effortOf(a, ctx) ?? -1),
  },
  // How long a task has waited — its Age chip (in the Freezer, how long it's been frozen).
  ageOldest: { key: "age-oldest", label: "Age: oldest", icon: AgeIcon, compare: (ctx) => (a, b) => waitedMs(b, ctx.now) - waitedMs(a, ctx.now) },
  ageNewest: { key: "age-newest", label: "Age: newest", icon: AgeIcon, compare: (ctx) => (a, b) => waitedMs(a, ctx.now) - waitedMs(b, ctx.now) },
});

export const TASK_DISPLAYS = catalog<DisplayOption>()({
  // The tab's tasks in Status bands: In progress, the Backlog (where tasks wait their turn), Blocked folded.
  status: { key: "status", label: "Status", icon: InProgressIcon },
  estimate: { key: "estimate", label: "Time estimate", icon: HourglassIcon },
  timer: { key: "timer", label: "Timer", icon: TimerIcon },
  grouping,
  // The way back to finished one-time tasks, at the bottom of the tab. Offered by no tab today.
  completed: { key: "completed", label: "Completed tasks", icon: CircleCheckIcon },
  // The way back to pruned tasks before their day or week is up.
  pruned: { key: "pruned", label: "Pruned tasks", icon: ScissorsIcon },
  // How long each task has waited, beside its name (AgeChip).
  age: { key: "age", label: "Age", icon: AgeIcon },
  // How many tasks the tab lists, under its title — by priority where they have more than one (TaskCount).
  count: { key: "task-count", label: "Task count", icon: TallyIcon },
  // A frosted task's line under it, keyed by the frost modifier's id — a Display option keyed by a modifier
  // shows or hides that modifier's line (see SectionCard) — and the bar on it while it's on ice.
  frost: { key: "frost", label: "Frost bonus", icon: SnowflakeIcon, defaultOn: true },
  meters: { key: "meters", label: "Frost bar", icon: MeterIcon, defaultOn: true },
  // What thawing a frosted task pays, under its frost.
  thawBonus: { key: "thaw-bonus", label: "Thaw bonus", icon: ThawIcon, defaultOn: true },
  add: addButton("task"),
});

// What a board tab of tasks is for, read off its settings — never its name: a Freezer; a to-do list (its tasks
// are done once and leave); a routine (its tasks can be pruned — every day's or week's checklist); or a
// tracker of habits you level up (tiers and tallies).
type TaskTabRole = "freezer" | "todo" | "routine" | "habits";

function roleOf(section: Section): TaskTabRole {
  if (section.freezerFor) return "freezer";
  const allows = (flag: "retiresWhenDone" | "prunable") => section.allowedTypes.some((a) => behaviorOfType(a.type)[flag]);
  if (allows("retiresWhenDone")) return "todo";
  return allows("prunable") ? "routine" : "habits";
}

/** What a board tab of tasks offers in its Sort and Display menus. */
export function taskTabOffer(section: Section): TabOffer<Task, TaskSortContext> {
  const s = TASK_SORTS;
  const d = TASK_DISPLAYS;
  switch (roleOf(section)) {
    // A checklist you tick through: get the quick ones done, keep its groups, and see what's pruned.
    case "routine":
      return {
        sorts: [
          offer(s.manual, pinned),
          offer(s.quick, pinned),
          offer(s.effortAsc, pinned),
          s.effortDesc,
          s.incompleteFirst,
          s.completeFirst,
          s.pointsDesc,
          s.pointsAsc,
          s.timeAsc,
          s.timeDesc,
        ],
        displays: [offer(d.grouping, pinned), offer(d.estimate, pinned), ...(section.period ? [offer(d.pruned, pinned)] : []), d.timer, d.add],
      };
    // Habits you level up: what's left today, and the timer that picks a tier. Their time lives in their tiers,
    // so the time sorts mean nothing here; their effort is their tiers'.
    case "habits":
      return {
        sorts: [offer(s.manual, pinned), offer(s.incompleteFirst, pinned), s.completeFirst, s.pointsDesc, s.pointsAsc, s.effortAsc, s.effortDesc],
        displays: [offer(d.timer, pinned), offer(d.grouping, pinned), d.estimate, d.add],
      };
    // A to-do list: what matters most first — its own order, or by priority; what's been waiting longest is
    // worth seeing. Done tasks leave it, so done-first sorts mean nothing here. Only here do tasks have a
    // status and a priority.
    case "todo":
      return {
        sorts: [
          offer(s.manual, pinned),
          offer(s.priorityHigh, pinned),
          offer(s.priorityAll, pinned),
          offer(s.quick, pinned),
          offer(s.ageOldest, pinned),
          offer(s.effortAsc, pinned),
          s.effortDesc,
          s.ageNewest,
          s.pointsDesc,
          s.pointsAsc,
          s.timeAsc,
          s.timeDesc,
        ],
        displays: [
          offer(d.status, { ...pinned, defaultOn: true }),
          offer(d.age, { ...pinned, defaultOn: true }),
          offer(d.count, { ...pinned, defaultOn: true }),
          offer(d.add, { ...pinned, defaultOn: true }),
          d.estimate,
          d.timer,
          offer(d.grouping, { defaultOn: false }),
        ],
      };
    // Tasks on ice: how long each has been frozen is their age there, and what thawing it would pay. Nothing
    // here can be done or timed.
    case "freezer":
      return {
        sorts: [
          offer(s.manual, pinned),
          offer(s.ageOldest, { ...pinned, label: "Days frozen: most", icon: SnowflakeIcon }),
          offer(s.ageNewest, { label: "Days frozen: fewest", icon: SnowflakeIcon }),
          s.pointsDesc,
          s.pointsAsc,
          s.timeAsc,
          s.timeDesc,
          s.effortAsc,
          s.effortDesc,
        ],
        displays: [
          offer(d.age, { ...pinned, defaultOn: true, label: "Days frozen", icon: SnowflakeIcon }),
          offer(d.frost, pinned),
          offer(d.meters, pinned),
          offer(d.thawBonus, pinned),
          d.estimate,
          offer(d.grouping, { defaultOn: false }),
        ],
      };
  }
}

// ---- Streaks ----

export const STREAKS_OFFER: TabOffer<StreakView, void> = {
  sorts: [
    { key: "manual", label: "Manual", icon: SparkleIcon, pinned: true },
    { key: "count-desc", label: "Streak: high to low", icon: ArrowDownIcon, pinned: true, compare: () => (a, b) => b.count - a.count },
    { key: "count-asc", label: "Streak: low to high", icon: ArrowUpIcon, compare: () => (a, b) => a.count - b.count },
  ],
  displays: [offer(grouping, pinned), offer(addButton("streak"), pinned)],
};

// ---- Rewards ----

/** What the reward sorts need to know: what each costs now (the weekend sale off it — a timed one's, for an
 *  hour), and what you can spend. */
export interface RewardSortContext {
  price: (reward: Reward) => number;
  points: number;
  closed: boolean; // a negative balance closes the shop
}

/** Whether a reward can be bought right now — a mirror of the server's check, which has the final say. */
export const canAfford = (price: number, ctx: Pick<RewardSortContext, "points" | "closed">): boolean => !ctx.closed && ctx.points >= price;

const REWARD_SORTS = catalog<SortOption<Reward, RewardSortContext>>()({
  manual: { key: "manual", label: "Manual", icon: SparkleIcon },
  // What you can have now leads (cheapest first within each band).
  affordable: {
    key: "affordable",
    label: "Can afford first",
    icon: CircleCheckIcon,
    compare: (ctx) => {
      const band = (r: Reward) => Number(!canAfford(ctx.price(r), ctx));
      return (a, b) => band(a) - band(b) || ctx.price(a) - ctx.price(b);
    },
  },
  costAsc: { key: "cost-asc", label: "Cost: low to high", icon: ArrowUpIcon, compare: (ctx) => (a, b) => ctx.price(a) - ctx.price(b) },
  costDesc: { key: "cost-desc", label: "Cost: high to low", icon: ArrowDownIcon, compare: (ctx) => (a, b) => ctx.price(b) - ctx.price(a) },
  mostBought: { key: "bought-desc", label: "Most bought", icon: FlameIcon, compare: () => (a, b) => b.redeemed - a.redeemed },
  // createdAt is an ISO string, so comparing the strings is chronological.
  newest: { key: "added-newest", label: "Date added: newest", icon: ArrowDownIcon, compare: () => (a, b) => b.createdAt.localeCompare(a.createdAt) },
  oldest: { key: "added-oldest", label: "Date added: oldest", icon: ArrowUpIcon, compare: () => (a, b) => a.createdAt.localeCompare(b.createdAt) },
});

const REWARD_DISPLAYS = catalog<DisplayOption>()({
  note: { key: "note", label: "Note", icon: PencilIcon },
  bought: { key: "bought", label: "Times bought", icon: BagIcon },
  // One-time rewards already bought, hatched at the bottom (like Completed tasks).
  owned: { key: "owned", label: "Already bought", icon: CircleCheckIcon },
  grouping,
  add: addButton("reward"),
});

/** What a shop tab offers. "Already bought" only where there's a one-time reward to have bought. */
export function shopTabOffer(hasOnce: boolean): TabOffer<Reward, RewardSortContext> {
  const s = REWARD_SORTS;
  const d = REWARD_DISPLAYS;
  return {
    sorts: [offer(s.manual, pinned), offer(s.affordable, pinned), s.costAsc, s.costDesc, s.mostBought, s.newest, s.oldest],
    displays: [
      offer(d.note, { ...pinned, defaultOn: true }),
      offer(d.bought, pinned),
      ...(hasOnce ? [offer(d.owned, pinned)] : []),
      offer(d.grouping, pinned),
      d.add,
    ],
  };
}
