import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { dayKeyFor, windDownState } from "./types";
import type { Settings } from "./types";
import Tooltip from "./Tooltip";
import { useFreeSpot } from "./useFreeSpot";

// The screen-off wind-down nudge (see PRODUCT/ARCHITECTURE). As the configured target time nears, an
// overlay grows from a small centred card into a full-viewport takeover that dims the board toward
// black — a deliberate psychological push to shut the screens off by then. Two exits:
//  - "Acknowledge" winds the takeover down (elaborate collapse) into a small analog clock that floats
//    on the board (free-spot placement, avoids the points HUD) — off your way but on the back of your
//    mind, glowing red once the time is past. Click it to bring the alert back.
//  - "Dismiss for today" clears it until tomorrow.
// It references no task — a generic time nudge over its own config (prime directive).

const DEFAULT_MESSAGE = "Time to shut down your screens.";

// Growth eased so it stays subtle most of the lead window and rushes in near the deadline.
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

// Wall-clock h/m/s of an instant in the board timezone (so it matches the target's minute-of-day).
function clockParts(iso: string, timeZone: string): { h: number; m: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { h: get("hour") % 24, m: get("minute"), s: get("second") };
}

// A burning candle whose wax burns *down* as the target nears (`burn` 0→1). While there's time left it
// carries a flickering flame; once past the target the flame is out and a wisp of smoke rises — a
// whiteboard-object stand-in for "your time is nearly up".
function Candle({ burn, past }: { burn: number; past: boolean }) {
  const base = 54; // y of the wax pool the candle sits in
  // Wax burns from full down to ~nothing at the target (burn 1), so the last sliver reads "about to
  // finish" instead of jumping from a tall stub to done. Full height kept a touch short (36, not 40)
  // so the flame doesn't float above the candle when brand-new.
  const bodyH = lerp(36, 0, Math.min(1, Math.max(0, burn)));
  const top = base - bodyH; // top of the wax (where the wick + flame sit)
  return (
    <svg className="wd-candle" viewBox="0 0 40 64" width={40} height={58} aria-hidden="true">
      <ellipse className="wd-candle-base" cx="20" cy={base + 2} rx="13" ry="3" />
      <rect className="wd-candle-body" x="12" y={top} width="16" height={bodyH} rx="3" />
      <line className="wd-candle-wick" x1="20" y1={top} x2="20" y2={top - 3} />
      {past ? (
        <path className="wd-candle-smoke" d={`M20 ${top - 3} q 6 -5 0 -10 q -6 -5 0 -10`} fill="none" />
      ) : (
        <path
          className="wd-candle-flame"
          d={`M20 ${top - 2} C 26 ${top - 8}, 23 ${top - 15}, 20 ${top - 18} C 17 ${top - 15}, 14 ${top - 8}, 20 ${top - 2} Z`}
        />
      )}
    </svg>
  );
}

// The minimized state: a small physical clock that free-floats in a board gap (avoiding cards, header
// and the points HUD), springs in when you acknowledge, and pulses red once the target's past.
function WindDownClock({
  burn,
  timeText,
  past,
  onExpand,
  onDismiss,
}: {
  burn: number;
  timeText: string;
  past: boolean;
  onExpand: () => void;
  onDismiss: () => void;
}) {
  // Free-spot like the HUD, but also steer clear of the HUD itself (pass its selector as an obstacle).
  const ref = useFreeSpot(".hud-anchor");
  return (
    <div className="wd-clock-anchor" ref={ref}>
      <motion.div
        className={`wd-clock${past ? " past" : ""}`}
        initial={{ scale: 0.2, opacity: 0, rotate: -30 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        exit={{ scale: 0.2, opacity: 0, transition: { duration: 0.2 } }}
        // Delayed so it springs in as the panel's melt settles into wax (see the exit in renderFull).
        transition={{ type: "spring", stiffness: 240, damping: 17, delay: 0.5 }}
      >
        <Tooltip label="Open the wind-down alert">
          <button type="button" className="wd-clock-open" onClick={onExpand} aria-label="Open the wind-down alert">
            <Candle burn={burn} past={past} />
          </button>
        </Tooltip>
        <div className="wd-clock-info">
          <span className="wd-clock-time">{timeText}</span>
          <span className="wd-clock-label">{past ? "Screens off" : "Wind-down"}</span>
        </div>
        <button type="button" className="wd-clock-dismiss" onClick={onDismiss} aria-label="Dismiss for today">
          ×
        </button>
      </motion.div>
    </div>
  );
}

interface WindDownOverlayProps {
  // The board's effective "now" (debug-pinned or real) and whether it's pinned. When pinned we freeze
  // to it so the owner can *preview* any moment via the debug clock; otherwise we self-tick.
  now: string;
  pinned: boolean;
  settings: Settings;
}

function WindDownOverlay({ now, pinned, settings }: WindDownOverlayProps) {
  const reduce = useReducedMotion();
  // Tick every second while live so the clock (analog + digital) actually ticks. Frozen while a debug
  // time is pinned, so the overlay shows exactly that instant for previewing.
  const [liveNow, setLiveNow] = useState(now);
  useEffect(() => {
    if (pinned) return;
    setLiveNow(new Date().toISOString());
    const id = setInterval(() => setLiveNow(new Date().toISOString()), 1000);
    return () => clearInterval(id);
  }, [pinned]);

  // The full message pops at configured triggers (see settings.windDown.displayTriggers), not
  // continuously. `shownFull` = the takeover is up now; `hasAppeared` = at least one trigger fired this
  // session, so the candle persists between pops. `doneDay` = dismissed until tomorrow.
  const [shownFull, setShownFull] = useState(false);
  const [hasAppeared, setHasAppeared] = useState(false);
  const [doneDay, setDoneDay] = useState<string | null>(null);
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);
  const firedRef = useRef<Set<number>>(new Set()); // "before" triggers already fired this session
  const mountRef = useRef(true);

  const wd = settings.windDown;
  const effNow = pinned ? now : liveNow;
  const state = windDownState(effNow, settings);
  const today = dayKeyFor(effNow, settings);

  // A new day re-arms everything (all state is session-scoped; a reload also resets it).
  const prevDay = useRef(today);
  useEffect(() => {
    if (prevDay.current !== today) {
      prevDay.current = today;
      firedRef.current = new Set();
      mountRef.current = true; // re-seed on the next tick as if freshly loaded into the new day
      setShownFull(false);
      setHasAppeared(false);
      setConfirmingDismiss(false);
    }
  }, [today]);

  // Fire the display triggers. On (re)mount we SEED — mark any "before" trigger whose moment already
  // passed as fired (so we don't retro-pop the whole list), and let an "on refresh" trigger pop once
  // we're already inside the window. On later ticks, a "before" trigger pops as its moment is crossed.
  useEffect(() => {
    if (!wd.enabled || doneDay === today || state.phase === "idle") return;
    const seeding = mountRef.current;
    mountRef.current = false;
    let pop = false;
    wd.displayTriggers.forEach((t, i) => {
      if (t.kind !== "before") return;
      if (state.minutesToTarget <= t.minutes && !firedRef.current.has(i)) {
        firedRef.current.add(i);
        if (!seeding) pop = true; // live crossing pops; a moment already past at load just seeds
      }
    });
    if (seeding && wd.displayTriggers.some((t) => t.kind === "refresh")) pop = true; // on-refresh
    if (pop) {
      setShownFull(true);
      setHasAppeared(true);
    }
  }, [effNow, wd.enabled, wd.displayTriggers, doneDay, today, state.phase, state.minutesToTarget]);

  const parts = clockParts(effNow, settings.timeZone);
  const timeText = `${pad(parts.h)}:${pad(parts.m)}:${pad(parts.s)}`;
  const past = state.phase === "takeover";
  // The candle burns only over the final CANDLE_BURN_MINUTES before the target — regardless of how
  // early the nudge first popped. So it holds at full wax (idle) until 30 min out, then runs down on
  // an accelerating (quadratic ease-in) curve so it visibly speeds up as time runs out; fully gone
  // once past the target. Decoupled from `state.progress`, which tracks the configurable lead window.
  const CANDLE_BURN_MINUTES = 30;
  const burnT = past ? 1 : Math.max(0, Math.min(1, (CANDLE_BURN_MINUTES - state.minutesToTarget) / CANDLE_BURN_MINUTES));
  const burn = burnT * burnT; // ease-in: slow at first, faster and faster toward 0

  const acknowledge = () => {
    setConfirmingDismiss(false);
    setShownFull(false);
  };

  const armed = wd.enabled && state.phase !== "idle" && doneDay !== today;

  // Full-overlay growth: size + dim scale with progress toward the target. Floors kept generous so the
  // message is always readable (it pops at discrete moments, so it never needs to be tiny).
  const p = past ? 1 : state.progress;
  const ease = p * p;
  const width = `${lerp(46, 100, ease)}vw`;
  const minHeight = `${lerp(34, 100, ease)}vh`;
  const radius = Math.round(lerp(22, 0, p));
  const fontScale = lerp(1.2, 2.3, ease);
  const backdropAlpha = lerp(0.1, 0.95, ease).toFixed(3);

  const mins = Math.max(0, Math.round(state.minutesToTarget));
  const target = hhmm(wd.targetMinutes);
  const countdown = past
    ? `It's past ${target} — screens off.`
    : `${mins} ${mins === 1 ? "minute" : "minutes"} until ${target}.`;

  return (
    <AnimatePresence mode="popLayout">
      {armed && shownFull ? (
        renderFull()
      ) : armed && hasAppeared ? (
        <WindDownClock
          key="clock"
          burn={burn}
          timeText={timeText}
          past={past}
          onExpand={() => setShownFull(true)}
          onDismiss={() => setDoneDay(today)}
        />
      ) : null}
    </AnimatePresence>
  );

  function renderFull() {
    return (
        <motion.div
          key="full"
          className="wind-down"
          role="alertdialog"
          aria-label="Wind-down: shut down your screens"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35, delay: 0.42 } }}
          transition={{ duration: 0.4 }}
        >
          <div className="wind-down-backdrop" style={{ background: `rgba(8, 10, 14, ${backdropAlpha})` }} />
          {/* Exit = echo-trail fly-to-corner: the panel streaks toward the corner while two staggered
              ghost copies fade behind it (After-Effects echo), then the Candle widget springs in. */}
          {!reduce &&
            [0.5, 0.3].map((peak, i) => (
              <motion.div
                key={i}
                className="wind-down-ghost"
                style={{ width, height: minHeight, borderRadius: radius }}
                exit={{
                  x: "42vw",
                  y: "44vh",
                  scale: 0.06,
                  opacity: [0, peak, 0],
                  transition: { duration: 0.8, times: [0, 0.5, 1], ease: [0.6, 0.02, 0.2, 1], delay: 0.07 * (i + 1) },
                }}
              />
            ))}
          <motion.div
            className="wind-down-panel"
            data-phase={state.phase}
            style={{ width, minHeight, borderRadius: radius, fontSize: `${fontScale}rem` }}
            exit={
              reduce
                ? { opacity: 0, transition: { duration: 0.3 } }
                : {
                    x: "42vw",
                    y: "44vh",
                    scale: 0.06,
                    opacity: [1, 1, 0],
                    transition: { duration: 0.8, times: [0, 0.75, 1], ease: [0.6, 0.02, 0.2, 1] },
                  }
            }
          >
            {!reduce && <div className="wind-down-glow" />}
            <motion.div
              className="wind-down-body"
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
            >
              <div className="wind-down-clock">{timeText}</div>
              <h2 className="wind-down-headline">{wd.message || DEFAULT_MESSAGE}</h2>
              <p className="wind-down-countdown">{countdown}</p>
              <div className="wind-down-actions">
                <button type="button" className="wind-down-primary" onClick={acknowledge}>
                  Acknowledge
                </button>
                {confirmingDismiss ? (
                  <div className="wind-down-confirm">
                    <span className="wind-down-confirm-q">Dismiss until tomorrow?</span>
                    <div className="wind-down-confirm-row">
                      <button type="button" className="wind-down-dismiss" onClick={() => setDoneDay(today)}>
                        Yes, dismiss
                      </button>
                      <button
                        type="button"
                        className="wind-down-cancel"
                        onClick={() => setConfirmingDismiss(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="wind-down-dismiss"
                    onClick={() => setConfirmingDismiss(true)}
                  >
                    Dismiss for today
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
    );
  }
}

export default WindDownOverlay;
