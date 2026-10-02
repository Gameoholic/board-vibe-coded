import { animate, motion, useMotionValue, useReducedMotion, useTransform, useVelocity } from "framer-motion";
import { useLayoutEffect, useRef, useState } from "react";
import type { RolledBounty } from "./types";

// A Bounty's roll: a slot reel of open tasks spins past a ticking pointer (blurring with its speed),
// coasts just past the one the server picked (the reel is only its show) and springs back onto it; then it
// bursts, the multiplier is stamped on, and it offers a reroll. Shown on the week recap's last page and in
// a mid-week reveal (BountyReveal).

// How long the reel spins before it lands, in seconds, and how far past the winner it coasts before it
// springs back onto it, in px (none of either under reduced motion).
const REEL_SPIN = 2.8;
const REEL_COAST = 28;
// The sparks thrown out as it lands — spread by their index, so a render is pure.
const SPARK_COLORS = ["#f59e0b", "#ef4444", "#3b82f6", "#22c55e"];
const SPARKS = Array.from({ length: 20 }, (_, i) => {
  const angle = (i / 20) * Math.PI * 2 + (i % 2 ? 0.16 : 0);
  const reach = 110 + (i % 3) * 40;
  return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach * 0.6, color: SPARK_COLORS[i % 4], size: 5 + (i % 3) * 2 };
});

interface BountyRollProps {
  bounty: RolledBounty;
  // Whether it may spin yet — several Bounties roll one after another.
  spin?: boolean;
  onLanded?: () => void;
  onReroll: () => void;
}

export function BountyRoll({ bounty, spin = true, onLanded, onReroll }: BountyRollProps) {
  // Every candidate takes its turns past the pointer — the winner too, so it isn't the one new name, and a
  // board with few open tasks still gets a proper spin — plenty of them ahead of the winner, and a few after
  // so it lands mid-reel. The lead stops one short of a full round, so the name before the winner is another.
  const pool = [...bounty.reel, bounty.text];
  const rounds = Math.ceil(Math.max(18, pool.length * 3) / pool.length);
  const lead = Array.from({ length: rounds * pool.length - (pool.length > 1 ? 1 : 0) }, (_, i) => pool[i % pool.length]);
  const chips = [...lead, bounty.text, ...pool.slice(0, 3)];
  const winner = lead.length;
  const trackRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<HTMLSpanElement>(null);
  // The latest onLanded, for the spin to call when it lands (the spin itself never restarts for it).
  const landedRef = useRef(onLanded);
  useLayoutEffect(() => {
    landedRef.current = onLanded;
  });
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const blur = useTransform(useVelocity(x), [-2500, 0, 2500], ["blur(2.5px)", "blur(0px)", "blur(2.5px)"]);
  const [landed, setLanded] = useState(false);

  useLayoutEffect(() => {
    const track = trackRef.current;
    const viewport = track?.parentElement;
    if (!spin || !track || !viewport) return;
    let run: ReturnType<typeof animate> | undefined;
    let gone = false;
    const middleOf = (i: number) => {
      const chip = track.children[i] as HTMLElement;
      return chip.offsetLeft + chip.offsetWidth / 2;
    };
    // Where the reel must stop for the winner to sit under the pointer — measured, not transformed, so it
    // holds mid-spin. Measured again as it springs back: names re-lay out when a swapped-in font arrives.
    const target = () => viewport.clientWidth / 2 - middleOf(winner);
    // The pointer ticks each time a new name passes under it, and that name lights up (DOM classes, so
    // the spin never re-renders).
    let under = -1;
    const stopTicking = x.on("change", (at) => {
      const mid = viewport.clientWidth / 2 - at;
      let nearest = 0;
      for (let i = 1; i < track.children.length; i++) if (Math.abs(middleOf(i) - mid) < Math.abs(middleOf(nearest) - mid)) nearest = i;
      if (nearest === under) return;
      track.children[under]?.classList.remove("under");
      track.children[nearest].classList.add("under");
      under = nearest;
      // The names travel left, so each one flicks the pointer's tip that way.
      if (pointerRef.current && !reduce) animate(pointerRef.current, { rotate: [28, 0] }, { duration: 0.16, ease: "easeOut" });
    });
    document.fonts.ready.then(() => {
      if (gone) return;
      run = animate(x, [0, target() - (reduce ? 0 : REEL_COAST)], { duration: reduce ? 0 : REEL_SPIN, ease: [0.1, 0.7, 0.18, 1] });
      run.then(() => {
        if (gone) return;
        run = animate(x, target(), reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 16, restDelta: 0.5 });
        run.then(() => {
          if (gone) return;
          setLanded(true);
          landedRef.current?.();
        });
      });
    });
    return () => {
      gone = true;
      run?.stop();
      stopTicking();
    };
  }, [spin, winner, x, reduce]);

  return (
    <motion.section
      className={`bounty-roll${landed ? " landed" : ""}`}
      aria-label={`Bounty: ${landed ? bounty.text : "rolling"}`}
      animate={landed && !reduce ? { x: [0, -8, 7, -4, 2, 0] } : undefined}
      transition={{ duration: 0.4, delay: 0.08 }}
    >
      <div className="bounty-stage">
        {/* The payoff's rays and sparks, clipped close around the reel so they never scroll the page. */}
        <div className="bounty-burst" aria-hidden>
          {landed && <div className="bounty-rays" />}
          {landed && !reduce && (
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
          <motion.div className="bounty-reel-track" ref={trackRef} style={{ x, filter: blur }}>
            {chips.map((name, i) => (
              <span key={i} className={i === winner && landed ? "hit" : undefined}>
                {name}
              </span>
            ))}
          </motion.div>
        </div>
      </div>
      <div className="bounty-roll-under">
        <motion.div
          className="bounty-mult"
          initial={false}
          animate={landed ? { opacity: 1, scale: 1, rotate: -6 } : { opacity: 0, scale: 2.8, rotate: -18 }}
          transition={landed ? { type: "spring", stiffness: 520, damping: 15, delay: 0.05 } : { duration: 0 }}
        >
          ×{bounty.multiplier}
        </motion.div>
        {/* In place from the start (hidden until it lands), so nothing jumps. */}
        {bounty.rerollsLeft > 0 && (
          <button type="button" className="ghost-btn" disabled={!landed} onClick={onReroll}>
            Reroll ({bounty.rerollsLeft} left)
          </button>
        )}
      </div>
    </motion.section>
  );
}

// What a Bounty means — said once the reels have landed, in place from the start so nothing jumps.
export function BountyExplain({ multiplier, several = false, shown }: { multiplier: number; several?: boolean; shown: boolean }) {
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
