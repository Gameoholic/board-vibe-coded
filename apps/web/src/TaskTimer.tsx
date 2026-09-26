import { useEffect, useMemo, useRef, useState } from "react";
import { TimerIcon } from "./Icons";
import Popover from "./Popover";
import { useClickOutside } from "./useClickOutside";
import type { TierDef } from "./types";

interface TaskTimerProps {
  taskId: string;
  color: string;
  timer?: { elapsedMs: number; isRunning: boolean; startedAt?: number };
  // Tier context is optional: passed only for tiered tasks, where crossing a tier's duration
  // auto-advances the pick and a Submit button locks in the reached tier. Omitted for every other
  // task type, which gets a plain stopwatch (no submit, no scoring effect).
  // No origin passed back: the flying-points animation always launches from the row's own [%]
  // bracket (TaskItem supplies it), never from this trigger button.
  tiers?: TierDef[];
  activeTier?: number | null;
  onSetTier?: (tierIndex: number | null) => void;
}

// Reads a duration straight out of a tier's own label ("1hr", "30min", "15 min") — no
// separate config, per docs-old/PRODUCT-SPEC.md §11.1: "auto-selects the tier from
// elapsed time". A label that doesn't parse just never auto-selects; nothing breaks.
function parseTierMinutes(label: string): number | null {
  const match = label.match(/(\d+(?:\.\d+)?)\s*(hr|hour|h|min|m)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return match[2].toLowerCase().startsWith("h") ? value * 60 : value;
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function TaskTimer({ taskId, color, timer, tiers, activeTier, onSetTier }: TaskTimerProps) {
  // Prefer each tier's stored estimate (set via its builder); fall back to scraping the label for
  // legacy tiers that predate per-tier minutes. A non-tiered task has no thresholds at all.
  const thresholds = useMemo(
    () => (tiers ?? []).map((t) => t.minutes ?? parseTierMinutes(t.label)),
    [tiers],
  );
  // Tier auto-advance + Submit only exist when this is a tiered task with at least one threshold.
  const tierMode = !!tiers && !!onSetTier && thresholds.some((m) => m !== null);

  const restoredElapsed =
    timer?.isRunning && timer.startedAt
      ? timer.elapsedMs + (Date.now() - timer.startedAt)
      : (timer?.elapsedMs ?? 0);

  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(timer?.isRunning ?? false);
  const [elapsedMs, setElapsedMs] = useState(restoredElapsed);
  const [manualMinutes, setManualMinutes] = useState("");
  const baseRef = useRef(timer?.isRunning && timer.startedAt ? timer.elapsedMs : restoredElapsed);
  const startRef = useRef<number | null>(timer?.isRunning && timer.startedAt ? timer.startedAt : null);
  const anchorRef = useRef<HTMLDivElement>(null);

  useClickOutside(anchorRef, () => setOpen(false), open);

  useEffect(() => {
    if (!running) return;
    const updateId = window.setInterval(() => {
      if (startRef.current != null) {
        const newElapsed = baseRef.current + (Date.now() - startRef.current);
        setElapsedMs(newElapsed);
      }
    }, 500);
    const saveId = window.setInterval(() => {
      if (startRef.current != null) {
        const newElapsed = baseRef.current + (Date.now() - startRef.current);
        saveTimer(newElapsed, true, startRef.current);
      }
    }, 10000);
    return () => {
      window.clearInterval(updateId);
      window.clearInterval(saveId);
    };
  }, [running]);

  // Timers are optional, pausable, and overridable — never required, never in the way
  // (§11.1). So this only ever pushes the tier *forward* as elapsed time crosses further
  // thresholds; it never downgrades a tier you picked manually. Only runs in tier mode.
  useEffect(() => {
    if (!running || !tierMode) return;
    const elapsedMinutes = elapsedMs / 60000;
    let best: number | null = null;
    thresholds.forEach((m, i) => {
      if (m !== null && elapsedMinutes >= m) best = i;
    });
    if (best !== null && best > (activeTier ?? -1)) {
      onSetTier?.(best);
    }
  }, [elapsedMs, running, tierMode, thresholds, activeTier, onSetTier]);

  async function saveTimer(newElapsed: number, newRunning: boolean, startedAt?: number) {
    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timer: { elapsedMs: newElapsed, isRunning: newRunning, startedAt } }),
    });
  }

  function start() {
    const now = Date.now();
    startRef.current = now;
    setRunning(true);
    saveTimer(baseRef.current, true, now);
  }

  function pause() {
    if (startRef.current != null) baseRef.current += Date.now() - startRef.current;
    startRef.current = null;
    setRunning(false);
    saveTimer(baseRef.current, false);
  }

  function reset() {
    baseRef.current = 0;
    startRef.current = running ? Date.now() : null;
    setElapsedMs(0);
    saveTimer(0, running);
  }

  function applyManualMinutes(value: string) {
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes < 0) return;
    const ms = minutes * 60000;
    baseRef.current = ms;
    startRef.current = running ? Date.now() : null;
    setElapsedMs(ms);
    saveTimer(ms, running, startRef.current ?? undefined);
  }

  return (
    <div className="popover-anchor timer-anchor" ref={anchorRef}>
      <button
        type="button"
        className={`timer-btn${running ? " running" : ""}`}
        aria-label="Timer"
        onClick={() => setOpen((v) => !v)}
      >
        <TimerIcon />
        {(running || elapsedMs > 0) && <span>{formatElapsed(elapsedMs)}</span>}
      </button>
      <Popover title="Timer" open={open} onClose={() => setOpen(false)} align="right" width={210}>
        <div className="timer-popover">
          <span className="timer-display">{formatElapsed(elapsedMs)}</span>
          <div className="timer-actions">
            {running ? (
              <button type="button" className="ghost-btn" onClick={pause}>
                Pause
              </button>
            ) : (
              <button type="button" className="ghost-btn" style={{ color }} onClick={start}>
                {elapsedMs > 0 ? "Resume" : "Start"}
              </button>
            )}
            <button type="button" className="ghost-btn" onClick={reset} disabled={elapsedMs === 0 && !running}>
              Reset
            </button>
          </div>
          <input
            className="timer-manual-input"
            type="number"
            min="0"
            step="1"
            placeholder="Or type minutes"
            value={manualMinutes}
            onChange={(e) => {
              setManualMinutes(e.target.value);
              applyManualMinutes(e.target.value);
            }}
          />
          {tierMode && (() => {
            const elapsedMinutes = elapsedMs / 60000;
            let best = 0;
            thresholds.forEach((m, i) => {
              if (m !== null && elapsedMinutes >= m) best = i;
            });
            return (
              <button
                type="button"
                className="ghost-btn timer-submit"
                style={{ color }}
                onClick={() => {
                  onSetTier?.(best);
                  setOpen(false);
                }}
              >
                Submit ({tiers![best].label})
              </button>
            );
          })()}
        </div>
      </Popover>
    </div>
  );
}

export default TaskTimer;
