import { useEffect, useRef, useState } from "react";
import type { Timer } from "./types";

// A stopwatch's reading — what the Stopwatch component draws. It keeps no time of its own: `timer` is what's
// on the clock as whoever owns it last left it, and every change goes back out through `onChange` (null once
// there's nothing on it). So the reading is always worked out from the timer handed in, and a reload, a
// remount or a change made elsewhere can't leave it out of step.

// How often a running stopwatch's reading is drawn again.
const TICK_MS = 500;

export interface StopwatchState {
  /** What's on the clock — or what's being typed over it. */
  elapsedMs: number;
  running: boolean;
  start: () => void;
  pause: () => void;
  /** Back to zero; still running, if it was. */
  reset: () => void;
  /** Minutes typed over the clock: read at once, and the timer's from when they're kept. */
  typed: string;
  setTyped: (text: string) => void;
  keepTyped: () => void;
}

// What's typed in the minutes field, as time on the clock — null while it holds no time.
function typedTime(text: string): number | null {
  const minutes = Number(text);
  return text.trim() !== "" && Number.isFinite(minutes) && minutes >= 0 ? minutes * 60_000 : null;
}

export function useStopwatch(timer: Timer | undefined, onChange: (timer: Timer | null) => void): StopwatchState {
  const running = timer?.isRunning ?? false;
  const [now, setNow] = useState(() => Date.now());
  // Typing isn't saved key by key (a passing 4 on the way to 45 would be a stopwatch set twice). The field's
  // text is also in a ref, so keeping it twice in one gesture — the panel closing, then the field losing
  // focus — only keeps it once.
  const [typed, setTypedText] = useState("");
  const typedRef = useRef("");
  const setTyped = (text: string) => {
    typedRef.current = text;
    setTypedText(text);
  };

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);

  // The time on the clock at `at`. A timer just started is a moment ahead of the last tick, hence the floor.
  const onClock = (at: number) => (timer?.elapsedMs ?? 0) + (running && timer?.startedAt != null ? Math.max(0, at - timer.startedAt) : 0);
  const typedMs = typedTime(typed);

  // Every change starts the count afresh from `elapsedMs`, and takes the place of anything typed.
  const set = (elapsedMs: number, run: boolean) => {
    setTyped("");
    onChange(run ? { elapsedMs, isRunning: true, startedAt: Date.now() } : elapsedMs > 0 ? { elapsedMs, isRunning: false } : null);
  };
  const reading = () => typedTime(typedRef.current) ?? onClock(Date.now());

  return {
    elapsedMs: typedMs ?? onClock(now),
    running,
    start: () => set(reading(), true),
    pause: () => set(reading(), false),
    reset: () => set(0, running),
    typed,
    setTyped,
    keepTyped: () => {
      const kept = typedTime(typedRef.current);
      if (kept !== null) set(kept, running);
    },
  };
}
