import { formatPercent } from "@board/contracts";
import { animate, motion } from "framer-motion";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { FlyerTier } from "./flyerTiers";
import PointsPlate, { type PointsPlateHandle } from "./PointsPlate";
import { uid } from "./uid";
import { useDiegeticDepth } from "./useDiegeticDepth";
import { useFreeSpot } from "./useFreeSpot";

// How hard the landing hits. Handed over by the flyer that just arrived rather than looked up here,
// so the tier table stays the only place any of these magnitudes are written down.
type Landing = FlyerTier["landing"];

export interface PointsCounterHandle {
  getRect: () => DOMRect | null;
  burst: (landing: Landing) => void;
  // A purchase: the plate flinches and a red −amount floats out of it — spending should visibly hurt.
  spend: (amount: number) => void;
}

interface PointsCounterProps {
  total: number;
  // Sitting in the shop's top-centre dock rather than free-parked on the board (see useFreeSpot's
  // `dock`). Only adds a short transition delay so the move reads as following the board's poof.
  docked: boolean;
}

const DOCK_SLOT = ".hud-dock";

// A quick horizontal flinch of the plate box, shared by heavy landings and purchases.
function shake(box: HTMLElement, s: number) {
  animate(
    box,
    { x: [0, -s, s, -s * 0.66, s * 0.66, 0], rotate: [0, -0.7, 0.7, -0.35, 0.35, 0] },
    { duration: 0.42, ease: "easeOut" },
  );
}

interface Particle {
  id: string;
  angle: number;
  distance: number;
}

interface Shockwave {
  id: string;
  delay: number;
}

// The board HUD: a `PointsPlate` (the framed count-up readout) placed on the free canvas via
// `useFreeSpot`/`useDiegeticDepth` — or docked in a canvas's `.hud-dock` slot (the shop, the one-tab view, a
// phone's board: see CardCanvas) — with
// flyer-landing bursts (pulse, particles, shockwaves, shake, corner flare) and
// purchase flinches layered on top. The plate owns the number; this owns the drama.
const PointsCounter = forwardRef<PointsCounterHandle, PointsCounterProps>(({ total, docked }, ref) => {
  const anchorRef = useFreeSpot(undefined, DOCK_SLOT);
  const depthRef = useDiegeticDepth();
  const plateRef = useRef<PointsPlateHandle>(null);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [waves, setWaves] = useState<Shockwave[]>([]);
  const [spends, setSpends] = useState<{ id: string; amount: number }[]>([]);

  useImperativeHandle(ref, () => ({
    getRect: () => plateRef.current?.getValueRect() ?? null,
    spend: (amount) => {
      const id = uid();
      setSpends((prev) => [...prev, { id, amount }]);
      setTimeout(() => setSpends((prev) => prev.filter((s) => s.id !== id)), 900);
      const box = plateRef.current?.getBox();
      if (box) shake(box, 5);
    },
    burst: (landing) => {
      // Not the clock: two landings in one millisecond (a broken-down task's pieces, ticked in a row)
      // would give their particles the same keys.
      const stamp = uid();
      plateRef.current?.pulse(landing.pulse);

      const count = landing.particles;
      const newParticles: Particle[] = Array.from({ length: count }, (_, i) => ({
        id: `${stamp}-${i}`,
        angle: (Math.PI * 2 * i) / count + Math.random() * 0.4,
        distance: landing.distance + Math.random() * landing.jitter,
      }));
      setParticles((prev) => [...prev, ...newParticles]);
      setTimeout(() => {
        setParticles((prev) => prev.filter((p) => !newParticles.includes(p)));
      }, 650);

      if (landing.shockwaves > 0) {
        const newWaves: Shockwave[] = Array.from({ length: landing.shockwaves }, (_, i) => ({
          id: `${stamp}-w${i}`,
          delay: i * 0.12,
        }));
        setWaves((prev) => [...prev, ...newWaves]);
        setTimeout(() => {
          setWaves((prev) => prev.filter((w) => !newWaves.includes(w)));
        }, 900);
      }

      // Driven imperatively rather than by a remount-on-key like the pulse: re-mounting the plate
      // would throw away the particles and shockwaves that are mid-flight inside it. Safe to write a
      // transform here — .hud-anchor's placement and .hud-depth's scroll drift are written on *their
      // own* nodes and compose with this one, so nothing is clobbered.
      const box = plateRef.current?.getBox();
      if (!box) return;
      if (landing.shake > 0) shake(box, landing.shake);
      if (landing.flare) {
        const corners = Array.from(box.querySelectorAll<HTMLElement>(".corner"));
        animate(corners, { scale: [1, 1.55, 1], opacity: [1, 0.5, 1] }, { duration: 0.5, ease: "easeOut" });
      }
    },
  }));

  return (
    <div className={`hud-anchor${docked ? " docked" : ""}`} ref={anchorRef}>
      <div className="hud-depth" ref={depthRef}>
        <PointsPlate ref={plateRef} label="Points" total={total}>
          {spends.map((s) => (
            <motion.span
              key={s.id}
              className="spend-float"
              initial={{ opacity: 0, y: 0, scale: 0.8 }}
              animate={{ opacity: [0, 1, 1, 0], y: 44, scale: 1 }}
              transition={{ duration: 0.85, ease: "easeOut" }}
            >
              −{formatPercent(s.amount)}
            </motion.span>
          ))}
          {waves.map((w) => (
            <motion.span
              key={w.id}
              className="shockwave"
              initial={{ scale: 0.25, opacity: 0.5 }}
              animate={{ scale: 3.4, opacity: 0 }}
              transition={{ duration: 0.6, delay: w.delay, ease: "easeOut" }}
            />
          ))}
          <div className="particle-field">
            {particles.map((p) => (
              <motion.span
                key={p.id}
                className="particle"
                initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                animate={{
                  x: Math.cos(p.angle) * p.distance,
                  y: Math.sin(p.angle) * p.distance,
                  opacity: 0,
                  scale: 0.3,
                }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
            ))}
          </div>
        </PointsPlate>
      </div>
    </div>
  );
});

PointsCounter.displayName = "PointsCounter";

export default PointsCounter;
