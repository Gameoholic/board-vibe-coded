import {
  AnimatePresence,
  motion,
  useIsPresent,
  type TargetAndTransition,
  type Transition,
} from "framer-motion";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type FlyerTier, tierFor } from "./flyerTiers";
import PointsBracket from "./PointsBracket";

// Matches .points-counter's red. Framer reads the flyer's *starting* colour off the DOM (it
// inherits .points-prefix's near-black), so only the destination needs naming here.
const COUNTER_RED = "#ef4444";
const GLOW_RGB = "239, 68, 68";

// Different easing per axis is what bends the flight into an arc — see flightTransition.
const X_EASE: [number, number, number, number] = [0.3, 0, 0.25, 1];
const Y_EASE: [number, number, number, number] = [0.6, 0, 0.5, 1];

// One rattle keyframe per ~60ms of wind-up. Deliberately one long keyframe array rather than a
// short one on `repeat`: an endlessly repeating property never reports completion, and the end of
// the wind-up is exactly what hands over to the flight (see FlyerItem's onAnimationComplete).
const RATTLE_STEP = 0.06;

// How far out the intake particles start, and how long each one takes to be pulled in.
const INTAKE_RADIUS = 46;
const INTAKE_DURATION = 0.5;

// Gap between a ghost and the copy ahead of it. Small enough that the trail reads as one smeared
// bracket rather than a queue of separate ones.
const GHOST_STAGGER = 0.055;
const GHOST_OPACITY = 0.42;

function dropShadow(px: number, alpha: number) {
  return `drop-shadow(0 0 ${px}px rgba(${GLOW_RGB}, ${alpha}))`;
}

// A rattle that builds rather than decays — it's charging up, not recovering from a knock. Starts
// and ends at 0 so the launch doesn't inherit a sideways offset.
function rattle(amplitude: number, steps: number) {
  return Array.from({ length: steps }, (_, i) => {
    if (i === 0 || i === steps - 1) return 0;
    const ramp = i / (steps - 1);
    return (i % 2 === 0 ? 1 : -1) * amplitude * (0.35 + 0.65 * ramp);
  });
}

// What a task row hands over when something scores: the exact on-screen box of its [%] element
// plus the numbers it was showing. That's everything needed to launch a pixel-identical
// stand-in from that same spot — a centre point alone isn't enough.
export interface FlyOrigin {
  rect: DOMRect;
  percents: number[];
}

export interface Point {
  x: number;
  y: number;
}

export interface Flyer {
  id: string;
  taskId: string;
  amount: number;
  percents: number[];
  // It finishes a broken-down task: celebrated as the whole task (see tierFor).
  finale?: boolean;
  from: { x: number; y: number; width: number; height: number };
  to: Point;
}

interface FlyingPointsProps {
  flyers: Flyer[];
  // Re-measured at launch rather than reused from spawn time: a wind-up can last a second, and the
  // HUD moves itself (useFreeSpot re-places it, useDiegeticDepth drifts it on scroll), so a target
  // captured at spawn can be stale by the time the flight actually starts.
  getTarget: () => Point | null;
  onLand: (id: string, tier: FlyerTier) => void;
}

// The anticipation beat, for tiers that have one: the bracket rattles and swells in place before it
// launches. It costs nothing to stage, because the flyer already sits exactly over the row's own
// bracket with the real one hidden — so this reads as *that* bracket straining, not as an effect
// playing next to it.
function windupTarget(tier: FlyerTier): TargetAndTransition {
  const { duration, shake, swell, glow } = tier.windup;
  const steps = Math.max(5, Math.round(duration / RATTLE_STEP));
  return {
    x: rattle(shake, steps),
    rotate: rattle(1.6, steps),
    // Swells, eases back a touch, then surges to full — it reads as drawing breath.
    scale: [1, 1 + (swell - 1) * 0.55, 1 + (swell - 1) * 0.42, swell],
    ...(glow > 0 ? { filter: dropShadow(glow, 0.85) } : {}),
  };
}

// Every property carries its own `duration`. That is not redundant: framer only merges a per-value
// transition with its parent when the value transition opts in with `inherit: true` — otherwise the
// parent's `duration` never reaches it and the value silently falls back to the keyframe
// generator's own 300ms default. Leaving it off is what made the pre-tier flight run ~0.3s while
// its `duration: 1` and every comment around it claimed a full second.
function windupTransition(tier: FlyerTier): Transition {
  const duration = tier.windup.duration;
  return {
    duration,
    x: { duration, ease: "linear" },
    rotate: { duration, ease: "linear" },
    scale: { duration, ease: "easeInOut" },
    filter: { duration, ease: "easeIn" },
  };
}

function flightTarget(
  flyer: Flyer,
  target: Point,
  tier: FlyerTier,
  opts: { charged: boolean; opacity: number },
): TargetAndTransition {
  // Centre-to-centre delta, measured from a static left/top anchor and applied as a transform —
  // never by animating left/top (project convention).
  const dx = target.x - (flyer.from.x + flyer.from.width / 2);
  const dy = target.y - (flyer.from.y + flyer.from.height / 2);
  const { pop, overshoot } = tier.flight;
  const { swell, glow } = tier.windup;
  const o = 1 + overshoot;
  const { charged, opacity } = opts;

  // A leading `null` means "from wherever this value actually is", so the flight picks up from the
  // wind-up's end state instead of snapping back to a literal start keyframe.
  return {
    x: overshoot > 0 ? [null, dx * o, dx] : dx,
    y: overshoot > 0 ? [null, dy * o, dy] : dy,
    // Charged tiers compress out of the wind-up before they explode outward; uncharged ones get
    // the plain small lift they always had.
    scale: charged ? [null, swell * 0.82, pop, 0.72] : [1, pop, 0.72],
    // Stays fully opaque almost the whole way — fading early is what made it look like it
    // dissolved somewhere near the counter instead of arriving in it.
    opacity: [opacity, opacity, opacity, 0],
    color: COUNTER_RED,
    ...(charged ? { rotate: 0 } : {}),
    ...(glow > 0 ? { filter: dropShadow(0, 0) } : {}),
  };
}

function flightTransition(
  tier: FlyerTier,
  opts: { charged: boolean; overshoot: boolean; delay: number },
): Transition {
  const { charged, overshoot, delay } = opts;
  // Ghosts start late but still land with the leader, so the trail converges into the counter
  // instead of being cut off mid-air when the flyer lands and unmounts.
  const duration = tier.flight.duration - delay;
  const arc = { duration, delay, ...(overshoot ? { times: [0, 0.78, 1] } : {}) };

  return {
    duration,
    // Different easing per axis bends the path into an arc: it pulls away from the row sideways
    // first and then drops into the counter, instead of sliding down a dead straight line, which
    // is what read as "a thing being tweened" rather than thrown.
    x: { ...arc, ease: X_EASE },
    y: { ...arc, ease: Y_EASE },
    // Small lift as it detaches from the row, then it shrinks away into the HUD.
    scale: {
      duration,
      delay,
      times: charged ? [0, 0.1, 0.3, 1] : [0, 0.2, 1],
      ease: "easeOut",
    },
    opacity: { duration, delay, times: [0, 0.55, 0.88, 1], ease: "linear" },
    // Turns into the counter's red late in the flight, so it visibly stops being a board element
    // and becomes part of the HUD just before it lands. Proportional to the flight, so every tier
    // hands over at the same point in its own arc.
    color: { delay: delay + duration * 0.36, duration: duration * 0.52 },
    filter: { duration: duration * 0.5, delay },
  };
}

interface FlyerItemProps {
  flyer: Flyer;
  getTarget: () => Point | null;
  onLand: (id: string, tier: FlyerTier) => void;
}

// One flyer. Split out of the map purely because the wind-up needs per-flyer phase state, which a
// .map() body can't hold.
function FlyerItem({ flyer, getTarget, onLand }: FlyerItemProps) {
  const tier = useMemo(() => tierFor(flyer.amount, flyer.finale), [flyer.amount, flyer.finale]);
  const charged = tier.windup.duration > 0;
  const [charging, setCharging] = useState(charged);
  const [target, setTarget] = useState<Point>(flyer.to);
  const isPresent = useIsPresent();
  const landed = useRef(false);

  const { rings, intake, glow } = tier.windup;
  const cx = flyer.from.x + flyer.from.width / 2;
  const cy = flyer.from.y + flyer.from.height / 2;
  const overshoot = tier.flight.overshoot > 0;
  const bracketStyle = { left: flyer.from.x, top: flyer.from.y, width: flyer.from.width };

  // Fires once per settled animate target — so it is both the hand-off out of the wind-up and the
  // landing, and it fires for the exit fade too. Hence both guards: a landing must only ever be
  // reported once, and only by the flight. Without them, unchecking a box mid-flight would fire the
  // counter's burst for points that are in the middle of being taken back off it.
  function handleComplete() {
    if (!isPresent || landed.current) return;
    if (charging) {
      setTarget(getTarget() ?? flyer.to);
      setCharging(false);
      return;
    }
    landed.current = true;
    onLand(flyer.id, tier);
  }

  return (
    <>
      {charging && (
        <>
          {Array.from({ length: rings }, (_, i) => (
            <motion.span
              key={`ring-${i}`}
              className="flyer-ring"
              style={{ left: cx, top: cy }}
              initial={{ scale: 0.2, opacity: 0 }}
              animate={{ scale: [0.2, 1.7], opacity: [0, 0.5, 0] }}
              transition={{
                duration: tier.windup.duration * 0.6,
                delay: (i * tier.windup.duration) / Math.max(rings, 1),
                ease: "easeOut",
                repeat: Infinity,
              }}
            />
          ))}
          {/* The landing burst, reversed: dots pulled *into* the bracket is what makes the pause
              read as charging up rather than as the animation having stalled. */}
          {Array.from({ length: intake }, (_, i) => {
            const angle = (Math.PI * 2 * i) / Math.max(intake, 1);
            return (
              <motion.span
                key={`intake-${i}`}
                className="flyer-intake"
                style={{ left: cx, top: cy }}
                initial={{
                  x: Math.cos(angle) * INTAKE_RADIUS,
                  y: Math.sin(angle) * INTAKE_RADIUS,
                  opacity: 0,
                  scale: 0.4,
                }}
                animate={{ x: 0, y: 0, opacity: [0, 1, 0], scale: [0.4, 1, 0.2] }}
                transition={{
                  duration: INTAKE_DURATION,
                  delay: i * 0.05,
                  ease: "easeIn",
                  repeat: Infinity,
                }}
              />
            );
          })}
        </>
      )}

      {/* Afterimages, rendered before the real flyer so they sit behind it. Same <PointsBracket/>,
          so the trail is the bracket smearing rather than a row of generic dots. Deliberately no
          onAnimationComplete and no exit: only the real flyer reports the landing, and a child with
          an exit animation would hold up the whole flyer's removal. */}
      {!charging &&
        Array.from({ length: tier.flight.ghosts }, (_, i) => (
          <motion.div
            key={`ghost-${i}`}
            className="flyer points-prefix"
            style={bracketStyle}
            aria-hidden
            initial={{ x: 0, y: 0, scale: 1, opacity: 0 }}
            animate={flightTarget(flyer, target, tier, {
              charged,
              opacity: GHOST_OPACITY * (1 - i / (tier.flight.ghosts + 1)),
            })}
            transition={flightTransition(tier, {
              charged,
              overshoot,
              delay: (i + 1) * GHOST_STAGGER,
            })}
          >
            <PointsBracket percents={flyer.percents} />
          </motion.div>
        ))}

      <motion.div
        className="flyer points-prefix"
        style={bracketStyle}
        initial={{
          x: 0,
          y: 0,
          scale: 1,
          opacity: 1,
          ...(glow > 0 ? { filter: dropShadow(0, 0) } : {}),
        }}
        animate={
          charging ? windupTarget(tier) : flightTarget(flyer, target, tier, { charged, opacity: 1 })
        }
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
        transition={
          charging ? windupTransition(tier) : flightTransition(tier, { charged, overshoot, delay: 0 })
        }
        onAnimationComplete={handleComplete}
      >
        <PointsBracket percents={flyer.percents} />
      </motion.div>
    </>
  );
}

// The illusion this is built around: nothing is "added on top" of the row. The flyer is the
// same <PointsBracket/> the row renders, carrying the row's own .points-prefix class (so its
// size, weight, tabular figures and colour are identical by construction, not by copied
// values), pinned to the source element's exact rect — while the row hides its real bracket for
// the duration (.points-prefix.in-flight). So the bracket appears to detach and leave, rather
// than a red badge appearing near it. If this is touched, those three things are the trick:
// same component, same class, exact rect, original hidden.
//
// How *loudly* it leaves is the tier's business, not this file's — every magnitude and threshold
// lives in flyerTiers.ts. The one visual liberty taken with the bracket itself is the wind-up glow
// (a filter, not typography) and it ramps from zero, so the moment of detachment still matches the
// row pixel-for-pixel.
function FlyingPoints({ flyers, getTarget, onLand }: FlyingPointsProps) {
  return createPortal(
    <div className="flyer-layer">
      <AnimatePresence>
        {flyers.map((f) => (
          <FlyerItem key={f.id} flyer={f} getTarget={getTarget} onLand={onLand} />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

export default FlyingPoints;
