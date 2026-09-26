import { useEffect, useRef } from "react";

const SCROLL_IMPULSE = 0.035;
const SCROLL_STIFFNESS = 0.05;
const SCROLL_DAMPING = 0.26;
const MAX_DRIFT = 26;
const MAX_DRIFT_VELOCITY = 5;
const EPSILON = 0.005;

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

// Keeps the points counter from reading as a decal stuck to the glass: each wheel flick nudges
// it against the scroll direction, then it springs back. Pure rAF + refs — no React state, so
// it never triggers a re-render; the loop self-terminates once settled.
//
// This used to also apply a pointer-driven 3D tilt (the widget leaning toward the cursor). The
// owner disliked it following the mouse, so only the scroll response is left — which is the half
// that was actually carrying the "it's in the scene, not on the screen" job anyway.
export function useDiegeticDepth() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = ref.current;
    if (!layer || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let drift = 0;
    let driftVelocity = 0;
    let lastScrollY = window.scrollY;
    let frame = 0;

    const draw = () => {
      frame = 0;

      driftVelocity += -SCROLL_STIFFNESS * drift - SCROLL_DAMPING * driftVelocity;
      drift += driftVelocity;
      if (Math.abs(drift) > MAX_DRIFT) {
        drift = clamp(drift, MAX_DRIFT);
        driftVelocity = 0;
      }

      const settled = Math.abs(drift) < EPSILON && Math.abs(driftVelocity) < EPSILON;
      if (settled) {
        drift = 0;
        driftVelocity = 0;
      }

      layer.style.transform = `translate3d(0, ${drift.toFixed(2)}px, 0)`;

      if (!settled) frame = requestAnimationFrame(draw);
    };

    const onScroll = () => {
      const scrollY = window.scrollY;
      const impulse = (scrollY - lastScrollY) * SCROLL_IMPULSE;
      driftVelocity = clamp(driftVelocity - impulse, MAX_DRIFT_VELOCITY);
      lastScrollY = scrollY;
      if (!frame) frame = requestAnimationFrame(draw);
    };

    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return ref;
}
