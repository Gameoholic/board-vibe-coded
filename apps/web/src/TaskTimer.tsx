import { useCallback, useEffect, useMemo, useState } from "react";
import Stopwatch from "./Stopwatch";
import type { TierDef, Timer } from "./types";
import { useStopwatch } from "./useStopwatch";

// A task's timer: the shared stopwatch (Stopwatch), saved on its task.

interface TaskTimerProps {
  taskId: string;
  color: string;
  timer?: Timer;
  // Tier context is optional: passed only for tiered tasks, where crossing a tier's duration
  // auto-advances the pick and a Submit button locks in the reached tier. Omitted for every other
  // task type, which gets a plain stopwatch (no submit, no scoring effect).
  // No origin passed back: the flying-points animation always launches from the row's own [%]
  // bracket (TaskItem supplies it), never from this trigger button.
  tiers?: TierDef[];
  activeTier?: number | null;
  onSetTier?: (tierIndex: number | null) => void;
}

// The server keeps a task's timer in memory only, so a restart forgets it. A running one is saved again this
// often, which puts it back while its board is still open.
const RESAVE_MS = 10_000;

// Reads a duration straight out of a tier's own label ("1hr", "30min", "15 min") — no
// separate config, per docs-old/PRODUCT-SPEC.md §11.1: "auto-selects the tier from
// elapsed time". A label that doesn't parse just never auto-selects; nothing breaks.
function parseTierMinutes(label: string): number | null {
  const match = label.match(/(\d+(?:\.\d+)?)\s*(hr|hour|h|min|m)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return match[2].toLowerCase().startsWith("h") ? value * 60 : value;
}

// The highest tier whose time `elapsedMs` has reached, if any.
function tierReached(thresholds: (number | null)[], elapsedMs: number): number | null {
  const elapsedMinutes = elapsedMs / 60000;
  let best: number | null = null;
  thresholds.forEach((m, i) => {
    if (m !== null && elapsedMinutes >= m) best = i;
  });
  return best;
}

function TaskTimer({ taskId, color, timer: saved, tiers, activeTier, onSetTier }: TaskTimerProps) {
  // Prefer each tier's stored estimate (set via its builder); fall back to scraping the label for
  // legacy tiers that predate per-tier minutes. A non-tiered task has no thresholds at all.
  const thresholds = useMemo(
    () => (tiers ?? []).map((t) => t.minutes ?? parseTierMinutes(t.label)),
    [tiers],
  );
  // Tier auto-advance + Submit only exist when this is a tiered task with at least one threshold.
  const tierMode = !!tiers && !!onSetTier && thresholds.some((m) => m !== null);

  // The board's tasks aren't told when a timer changes, so from here on the row's own copy is the timer.
  const [timer, setTimer] = useState(saved);
  const save = useCallback(
    (next: Timer | null) => {
      fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timer: next }),
      });
    },
    [taskId],
  );
  const watch = useStopwatch(timer, (next) => {
    setTimer(next ?? undefined);
    save(next);
  });

  useEffect(() => {
    if (!timer?.isRunning) return;
    const id = window.setInterval(() => save(timer), RESAVE_MS);
    return () => window.clearInterval(id);
  }, [timer, save]);

  // Timers are optional, pausable, and overridable — never required, never in the way
  // (§11.1). So this only ever pushes the tier *forward* as elapsed time crosses further
  // thresholds; it never downgrades a tier you picked manually. Only runs in tier mode.
  useEffect(() => {
    if (!watch.running || !tierMode) return;
    const best = tierReached(thresholds, watch.elapsedMs);
    if (best !== null && best > (activeTier ?? -1)) {
      onSetTier?.(best);
    }
  }, [watch.elapsedMs, watch.running, tierMode, thresholds, activeTier, onSetTier]);

  return (
    <Stopwatch watch={watch} color={color}>
      {(close) => {
        if (!tierMode || !tiers) return null;
        const best = tierReached(thresholds, watch.elapsedMs) ?? 0;
        return (
          <button
            type="button"
            className="ghost-btn timer-submit"
            style={{ color }}
            onClick={() => {
              onSetTier?.(best);
              close();
            }}
          >
            Submit ({tiers[best].label})
          </button>
        );
      }}
    </Stopwatch>
  );
}

export default TaskTimer;
