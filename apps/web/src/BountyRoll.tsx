import { animate, motion, useMotionValue, useReducedMotion, useTransform, useVelocity } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { BountyReel, BountyStatus, BountyStopped, RolledBounty } from "./types";
import { uid } from "./uid";

// A Bounty's roll: a slot reel of what's on ice that you swing yourself. Swipe it — with the mouse or a
// finger — and it's off at the swipe's pace (blurring with its speed, ticking past a pointer), slows down by
// itself, runs just past the spot it lands on and springs back onto it. How hard it's swung is how far it
// goes, so the swing decides the spot — and the server's reel, dealt before it, says which task that spot
// holds. A swipe too soft doesn't count: the reel goes back where it was, so it can't be eased onto a name.
// Then it bursts, the multiplier is stamped on, and it offers a reroll. Shown on the week recap's Bounty page
// and in a reveal over the board (BountyReveal), a reel for each Bounty to roll (BountyRolls).

// The weakest swipe that counts, in px a second as it's let go: a softer one is a nudge, not a swing.
const SWING_MIN = 1100;
// The stretch of a swipe its pace is read from, in ms — its last moments — and how far the pointer has to have
// gone for it to be a swipe at all, in px (a click isn't one, and is told nothing).
const SWING_WINDOW = 90;
const SWING_SLOP = 6;
// A swing sends the reel off at this many times its own pace — a flick of the wrist is a proper spin — and
// never faster than REEL_TOP, in spots a second.
const SWING_GAIN = 1.8;
const REEL_TOP = 30;
// How long a spin lasts before it stops by itself, in seconds: this, and this much more for each spot a
// second it set off at — a harder swing spins longer as well as faster.
const SPIN_BASE = 2.2;
const SPIN_PER_SPEED = 0.05;
// How a spin slows down: 1 − (1 − t)^n sets off n times faster than its average pace. So a spin lasting T
// covers its opening pace × T ÷ n — that's how far a swing carries — and one timed n × its distance ÷ its
// pace sets off at exactly that pace.
const SPIN_POWER = 3;
const spinEase = (t: number) => 1 - (1 - t) ** SPIN_POWER;
// It runs this far past the spot it lands on before it springs back, in spots.
const REEL_PAST = 0.18;
// The spring that brings it onto its spot: back from past it as it lands, and back to where it rested after
// a swipe that didn't count. (Its rest thresholds are in spots.)
const SETTLE = { type: "spring", stiffness: 420, damping: 16, restDelta: 0.003, restSpeed: 0.02 } as const;
// Spots kept drawn either side of the pointer, so the reel's ends never show — which makes this the cell the
// reel rests on before it's swung, and where each round of it starts.
const REEL_SIDE = 5;
// The cell under the pointer when the reel is at `place` — a round of `n` spots on, it's back on the cells it
// began with, which hold the same names, so going round never shows.
const cellAt = (place: number, n: number) => REEL_SIDE + ((((place - REEL_SIDE) % n) + n) % n);
// Where a skipped roll lands: any spot of the round, each as likely.
const anySpot = (n: number) => Math.floor(Math.random() * n);
// The sparks thrown out as it lands — spread by their index, so a render is pure.
const SPARK_COLORS = ["#f59e0b", "#ef4444", "#3b82f6", "#22c55e"];
const SPARKS = Array.from({ length: 20 }, (_, i) => {
  const angle = (i / 20) * Math.PI * 2 + (i % 2 ? 0.16 : 0);
  const reach = 110 + (i % 3) * 40;
  return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach * 0.6, color: SPARK_COLORS[i % 4], size: 5 + (i % 3) * 2 };
});

// What the line under a reel says: what to do with it, or what came of the last try.
const PROMPTS = {
  ready: "Swipe the reel",
  soft: "Too soft. Swipe it harder.",
  refused: "Couldn't roll it. Try again.",
};

interface BountyRollProps {
  // The reel to swing — null for a Bounty rolled before this was shown, whose reel is drawn landed on it.
  reel: BountyReel | null;
  // The Bounty it landed on, once it has.
  bounty: RolledBounty | null;
  // Whether it may be swung yet — several Bounties roll one after another.
  spin: boolean;
  rerollsLeft: number;
  canReroll: boolean;
  // Roll it onto a spot: what the server rolled there, or null when it refused.
  onRoll: (spot: number) => Promise<BountyStopped | null>;
  onLanded: (stopped: BountyStopped) => void;
  onReroll: () => void;
}

export function BountyRoll({ reel, bounty, spin, rerollsLeft, canReroll, onRoll, onLanded, onReroll }: BountyRollProps) {
  const reduce = !!useReducedMotion();
  // The names on the reel, spot by spot — for one already rolled, its task and a few others around it. The
  // track draws them round and round, the first spot on the cell the reel rests on.
  const names = reel ? reel.spots : bounty ? [bounty.text, ...bounty.reel] : [];
  const n = Math.max(1, names.length);
  const cells = n + 2 * REEL_SIDE;

  const [phase, setPhase] = useState<"ready" | "spinning" | "landed">(reel ? "ready" : "landed");
  // The cell it landed on and the name there, and whether it landed while this was up — its payoff plays
  // then, never for one shown already landed.
  const [hit, setHit] = useState(reel || !bounty ? null : { cell: REEL_SIDE, text: bounty.text });
  const [rolledHere, setRolledHere] = useState(false);
  // What came of the last try, if it didn't land: a swipe too soft to count, or a roll the server turned away.
  const [note, setNote] = useState<"soft" | "refused" | null>(null);
  const ready = phase === "ready" && spin;

  const trackRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<HTMLSpanElement>(null);
  const alive = useRef(true);
  const run = useRef<ReturnType<typeof animate>>(undefined);
  const under = useRef(-1);
  const ticked = useRef(REEL_SIDE);
  // The swipe in hand: its pointer, where it and the reel were as it took hold, a spot's width in px then,
  // and its last moments (for its pace as it's let go).
  const swipe = useRef<{ id: number; x: number; from: number; cell: number; trail: { t: number; x: number }[] } | null>(null);
  // The reel's place, in spots, counted on round after round: it's unbounded, and cellAt says which cell that
  // puts under the pointer. In spots, not px, so the reel holds its place whatever a resize does to a spot's
  // width. `rest` is where it sits between tries.
  const pos = useMotionValue(REEL_SIDE);
  const rest = useRef(REEL_SIDE);
  const transform = useTransform(pos, (p) => `translateX(calc(var(--reel-cell) * ${-(cellAt(p, n) + 0.5)}))`);
  const blur = useTransform(useVelocity(pos), [-14, 0, 14], ["blur(2.5px)", "blur(0px)", "blur(2.5px)"]);

  useEffect(() => {
    alive.current = true;
    // The name under the pointer lights up, and each one arriving flicks the pointer's tip the way the names
    // are travelling (DOM classes, so a spin never re-renders).
    const stopTicking = pos.on("change", (p) => {
      const track = trackRef.current;
      if (!track) return;
      const cell = Math.round(cellAt(p, n));
      if (cell !== under.current) {
        track.children[under.current]?.classList.remove("under");
        track.children[cell]?.classList.add("under");
        under.current = cell;
      }
      const at = Math.round(p);
      if (at === ticked.current) return;
      const tilt = at > ticked.current ? 28 : -28;
      ticked.current = at;
      if (pointerRef.current && !reduce) animate(pointerRef.current, { rotate: [tilt, 0] }, { duration: 0.16, ease: "easeOut" });
    });
    return () => {
      alive.current = false;
      run.current?.stop();
      stopTicking();
    };
  }, [pos, n, reduce]);

  // Take hold of the reel: it follows the pointer until it's let go.
  function grab(e: PointerEvent<HTMLDivElement>) {
    const cell = trackRef.current?.firstElementChild?.getBoundingClientRect().width;
    if (!ready || reduce || swipe.current || !cell || (e.pointerType === "mouse" && e.button !== 0)) return;
    run.current?.stop();
    e.currentTarget.setPointerCapture(e.pointerId);
    swipe.current = { id: e.pointerId, x: e.clientX, from: pos.get(), cell, trail: [{ t: e.timeStamp, x: e.clientX }] };
  }

  function drag(e: PointerEvent<HTMLDivElement>) {
    const held = swipe.current;
    if (!held || e.pointerId !== held.id) return;
    held.trail.push({ t: e.timeStamp, x: e.clientX });
    while (held.trail.length > 1 && e.timeStamp - held.trail[0].t > SWING_WINDOW) held.trail.shift();
    pos.set(held.from - (e.clientX - held.x) / held.cell);
  }

  // Let go of: a swipe strong enough is a swing — the reel's off the way it went, faster, longer and further
  // the harder it was, onto the spot that carries it to. A softer one is no swing at all: the reel springs
  // back to where it rested, to be swung again.
  function letGo(e: PointerEvent<HTMLDivElement>) {
    const held = swipe.current;
    if (!held || e.pointerId !== held.id) return;
    swipe.current = null;
    // Its pace as it ended, in px a second — leftwards is forwards, the way the names read.
    const since = held.trail.find((p) => e.timeStamp - p.t <= SWING_WINDOW);
    const pace = since && e.timeStamp > since.t ? ((since.x - e.clientX) / (e.timeStamp - since.t)) * 1000 : 0;
    if (Math.abs(pace) < SWING_MIN) {
      if (Math.abs(e.clientX - held.x) >= SWING_SLOP) setNote("soft");
      run.current = animate(pos, rest.current, SETTLE);
      return;
    }
    const speed = Math.min(REEL_TOP, (Math.abs(pace) / held.cell) * SWING_GAIN);
    const reach = (speed * (SPIN_BASE + SPIN_PER_SPEED * speed)) / SPIN_POWER;
    roll(Math.round(pos.get() + Math.sign(pace) * reach), { way: Math.sign(pace), speed });
  }

  // A swipe the browser took over (to scroll, say) was never one.
  function drop() {
    if (!swipe.current) return;
    swipe.current = null;
    run.current = animate(pos, rest.current, SETTLE);
  }

  // The reel lands on `to`: spun there by a swing, or put there at once (a skip's spot, and any roll with
  // motion reduced). The server has the last word on what that spot holds, so it only lands once it has
  // answered.
  async function roll(to: number, spun?: { way: number; speed: number }) {
    setPhase("spinning");
    setNote(null);
    const rolling = onRoll(cellAt(to, n) - REEL_SIDE).catch(() => null);
    if (!spun) {
      run.current?.stop();
      pos.set(to);
    } else {
      const past = to + spun.way * REEL_PAST;
      run.current = animate(pos, past, { duration: (SPIN_POWER * Math.abs(past - pos.get())) / spun.speed, ease: spinEase });
      await run.current;
      if (!alive.current) return;
      run.current = animate(pos, to, SETTLE);
      await run.current;
    }
    const stopped = await rolling;
    if (!alive.current) return;
    rest.current = to;
    if (!stopped) {
      // Refused: it rests where it stopped, to be swung again.
      setNote("refused");
      setPhase("ready");
      return;
    }
    setHit({ cell: cellAt(to, n), text: stopped.rolled.text });
    setRolledHere(true);
    setPhase("landed");
    onLanded(stopped);
  }

  const landed = phase === "landed";
  const prompt = note ? PROMPTS[note] : ready && !reduce ? PROMPTS.ready : null;
  return (
    <motion.section
      className={`bounty-roll${landed ? " landed" : ""}`}
      aria-label={`Bounty: ${hit ? hit.text : "rolling"}`}
      animate={rolledHere && !reduce ? { x: [0, -8, 7, -4, 2, 0] } : undefined}
      transition={{ duration: 0.4, delay: 0.08 }}
    >
      <div
        className={`bounty-stage${ready && !reduce ? " can-swing" : ""}`}
        onPointerDown={grab}
        onPointerMove={drag}
        onPointerUp={letGo}
        onPointerCancel={drop}
      >
        {/* The payoff's rays and sparks, clipped close around the reel so they never scroll the page. */}
        <div className="bounty-burst" aria-hidden>
          {landed && <div className="bounty-rays" />}
          {rolledHere && !reduce && (
            <div className="bounty-sparks">
              {SPARKS.map((s, i) => (
                <motion.span
                  key={i}
                  style={{ background: s.color, width: s.size, height: s.size }}
                  initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                  animate={{ x: s.x, y: s.y, opacity: 0, scale: 0.3 }}
                  transition={{ duration: 0.9, ease: [0.2, 0.8, 0.3, 1] }}
                />
              ))}
            </div>
          )}
        </div>
        <span className="bounty-pointer" ref={pointerRef} aria-hidden />
        <div className="bounty-reel">
          <motion.div className="bounty-reel-track" ref={trackRef} style={{ transform, filter: blur }}>
            {Array.from({ length: cells }, (_, k) => (
              <span key={k} className={hit?.cell === k ? "hit" : undefined}>
                {/* The landed one says what the server rolled there. */}
                <b>{hit?.cell === k ? hit.text : names[cellAt(k, n) - REEL_SIDE]}</b>
              </span>
            ))}
          </motion.div>
        </div>
      </div>
      <div className="bounty-roll-under">
        {landed ? (
          <>
            <motion.div
              className="bounty-mult"
              initial={rolledHere && !reduce ? { opacity: 0, scale: 2.8, rotate: -18 } : false}
              animate={{ opacity: 1, scale: 1, rotate: -6 }}
              transition={{ type: "spring", stiffness: 520, damping: 15, delay: 0.05 }}
            >
              ×{bounty?.multiplier ?? reel?.multiplier}
            </motion.div>
            {canReroll && (
              <button type="button" className="ghost-btn" onClick={onReroll}>
                Reroll ({rerollsLeft} left)
              </button>
            )}
          </>
        ) : (
          <>
            {prompt && <p className={`bounty-prompt${note ? " missed" : ""}`}>{prompt}</p>}
            {/* With motion reduced the reel is never swung: a button rolls it. Otherwise Skip does, for the
                keyboard too. */}
            {ready &&
              (reduce ? (
                <button type="button" className="btn-primary" onClick={() => roll(rest.current + anySpot(n))}>
                  Roll
                </button>
              ) : (
                <button type="button" className="ghost-btn skip-btn" onClick={() => roll(rest.current + anySpot(n))}>
                  Skip
                </button>
              ))}
          </>
        )}
      </div>
    </motion.section>
  );
}

interface BountyRollsProps {
  // The week's Bounties as this is first shown: those already rolled (drawn landed), the reel still to swing,
  // and the rerolls left.
  status: BountyStatus;
  onRoll: (spot: number) => Promise<BountyStopped | null>;
  // Reroll a Bounty: the week's Bounties with its new reel, or null when the server refused.
  onReroll: (taskId: string) => Promise<BountyStatus | null>;
  // Whether every reel has landed (a reroll's is swung again).
  onLandedChange?: (landed: boolean) => void;
  // What wraps each reel and the words after them, by its place — the recap's notes fall by these.
  slotClassName?: string;
  slotStyle?: (i: number) => CSSProperties;
}

interface Slot {
  id: string;
  reel: BountyReel | null;
  bounty: RolledBounty | null;
}

// A reel for each of the week's Bounties — those already rolled, then one for every stop the reel has left,
// swung one after another, each once the last has landed — then what a Bounty means.
export function BountyRolls({ status, onRoll, onReroll, onLandedChange, slotClassName, slotStyle }: BountyRollsProps) {
  // Kept from when this was first shown: a roll or a reroll changes a reel here, in its place, so none jumps.
  const [slots, setSlots] = useState<Slot[]>(() => [
    ...status.bounties.map((bounty) => ({ id: uid(), reel: null, bounty })),
    ...Array.from({ length: status.reel?.rolls ?? 0 }, () => ({ id: uid(), reel: status.reel, bounty: null })),
  ]);
  const [rerollsLeft, setRerollsLeft] = useState(status.rerollsLeft);
  const [rerolling, setRerolling] = useState(false);
  const turn = slots.findIndex((slot) => !slot.bounty);
  const landed = turn === -1;
  const landedChangeRef = useRef(onLandedChange);
  useLayoutEffect(() => {
    landedChangeRef.current = onLandedChange;
  });
  useEffect(() => {
    landedChangeRef.current?.(landed);
  }, [landed]);

  // A reel landed: it holds its Bounty, and the reels still waiting take the reel as it now is (that task is
  // off it) — or go, should it have no stop left for them.
  function land(i: number, stopped: BountyStopped) {
    setRerollsLeft(stopped.rerollsLeft);
    setSlots((all) => {
      let left = stopped.reel?.rolls ?? 0;
      return all.flatMap((slot, j) => {
        if (j === i) return [{ ...slot, bounty: stopped.rolled }];
        if (slot.bounty) return [slot];
        return left-- > 0 ? [{ ...slot, reel: stopped.reel }] : [];
      });
    });
  }

  // A landed one rerolled: its place takes the new reel, to be swung again.
  function reroll(i: number) {
    const taskId = slots[i].bounty?.taskId;
    if (!taskId || rerolling) return;
    setRerolling(true);
    onReroll(taskId).then((next) => {
      setRerolling(false);
      if (!next) return;
      setRerollsLeft(next.rerollsLeft);
      setSlots((all) => all.flatMap((slot, j) => (j !== i ? [slot] : next.reel ? [{ id: uid(), reel: next.reel, bounty: null }] : [])));
    });
  }

  const multiplier = slots[0]?.bounty?.multiplier ?? slots[0]?.reel?.multiplier;
  return (
    <>
      {slots.map((slot, i) => (
        // Keyed by its reel, so a reroll's starts afresh.
        <div key={slot.id} className={slotClassName} style={slotStyle?.(i)}>
          <BountyRoll
            reel={slot.reel}
            bounty={slot.bounty}
            spin={i === turn}
            rerollsLeft={rerollsLeft}
            canReroll={landed && !rerolling && rerollsLeft > 0}
            onRoll={onRoll}
            onLanded={(stopped) => land(i, stopped)}
            onReroll={() => reroll(i)}
          />
        </div>
      ))}
      {multiplier !== undefined && (
        <div className={slotClassName} style={slotStyle?.(slots.length)}>
          <BountyExplain multiplier={multiplier} several={slots.length > 1} shown={landed} />
        </div>
      )}
    </>
  );
}

// What a Bounty means — said once the reels have landed, in place from the start so nothing jumps.
function BountyExplain({ multiplier, several, shown }: { multiplier: number; several: boolean; shown: boolean }) {
  return (
    <motion.div
      className="bounty-explain"
      initial={false}
      animate={{ opacity: shown ? 1 : 0, y: shown ? 0 : 8 }}
      transition={{ delay: shown ? 0.35 : 0 }}
    >
      <p>
        Finish {several ? "one" : "it"} this week and earn <b>{multiplier}x more points</b>.
      </p>
    </motion.div>
  );
}
