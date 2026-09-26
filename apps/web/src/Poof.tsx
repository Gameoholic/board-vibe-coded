import { motion } from "framer-motion";
import { useMemo } from "react";
import { createPortal } from "react-dom";

export interface PoofCard {
  rect: DOMRect; // the tab's screen-space box
  color: string; // the tab's colour
}

export interface PoofBurst {
  id: number; // bump to replay — a fresh id remounts every piece
  cards: PoofCard[];
  // "out": the tabs leaving for the shop (dots scatter, outline echoes outward). "in": the exact
  // reverse on the way back (dots gather onto the edges, outline closes in).
  direction: "out" | "in";
}

const DOTS_PER_CARD = 10;
// "in" waits for the shop to fade out first. Paired with the tabs' own fade-in delay in App.css
// (.board-viewport .board-card transition), so the dots land as the tab reappears.
const IN_DELAY = 0.2;

// A random point on the rectangle's perimeter, plus its outward direction from the box's centre.
// Walks the edges clockwise from the top-left corner: top, right, bottom, left.
function edgePoint(r: DOMRect) {
  const { width: w, height: h } = r;
  let t = Math.random() * 2 * (w + h);
  let x: number;
  let y: number;
  if (t < w) [x, y] = [t, 0];
  else if ((t -= w) < h) [x, y] = [w, t];
  else if ((t -= h) < w) [x, y] = [w - t, h];
  else [x, y] = [0, h - (t - w)];
  const dx = x - w / 2;
  const dy = y - h / 2;
  const len = Math.hypot(dx, dy) || 1;
  return { x: r.left + x, y: r.top + y, nx: dx / len, ny: dy / len };
}

// The board tabs' transition into and out of shop mode, in the HUD's own burst vocabulary (the
// counter's landing dots and shockwave ring) rather than a cartoon cloud. The tab itself fades via CSS
// (main.shop-open). Portaled to <body> with fixed positioning so it sits above the board's isolated
// stacking context; rects are already screen px, so canvas zoom needs no handling.
function Poof({ burst }: { burst: PoofBurst | null }) {
  // Randomised once per burst so a re-render mid-animation doesn't reshuffle the dots.
  const dots = useMemo(() => {
    if (!burst) return [];
    return burst.cards.flatMap((card, ci) =>
      Array.from({ length: DOTS_PER_CARD }, (_, i) => {
        const p = edgePoint(card.rect);
        const dist = 14 + Math.random() * 20;
        return {
          key: `${burst.id}-${ci}-${i}`,
          color: card.color,
          x: p.x,
          y: p.y,
          dx: p.nx * dist,
          dy: p.ny * dist,
          size: 3 + Math.random() * 2,
          delay: Math.random() * 0.1,
        };
      }),
    );
  }, [burst]);

  if (!burst) return null;
  const out = burst.direction === "out";
  const base = out ? 0 : IN_DELAY;

  return createPortal(
    <div className="poof-layer" aria-hidden>
      {burst.cards.map((card, i) => (
        <motion.span
          key={`${burst.id}-ring-${i}`}
          className="poof-ring"
          style={{
            left: card.rect.left,
            top: card.rect.top,
            width: card.rect.width,
            height: card.rect.height,
            borderColor: card.color,
          }}
          initial={out ? { scale: 1, opacity: 0.55 } : { scale: 1.05, opacity: 0 }}
          animate={out ? { scale: 1.05, opacity: 0 } : { scale: [1.05, 1, 1], opacity: [0, 0.55, 0] }}
          transition={{ duration: out ? 0.45 : 0.6, delay: base, ease: "easeOut" }}
        />
      ))}
      {dots.map((d) => (
        <motion.span
          key={d.key}
          className="poof-dot"
          style={{ left: d.x - d.size / 2, top: d.y - d.size / 2, width: d.size, height: d.size, background: d.color }}
          initial={out ? { x: 0, y: 0, opacity: 1, scale: 1 } : { x: d.dx, y: d.dy, opacity: 0, scale: 0.4 }}
          animate={out ? { x: d.dx, y: d.dy, opacity: 0, scale: 0.4 } : { x: 0, y: 0, opacity: [0, 1, 0], scale: 1 }}
          transition={{
            duration: 0.5,
            delay: base + d.delay,
            ease: out ? "easeOut" : "easeIn",
            // Gathering dots hold full opacity until they reach the edge, then blink out.
            ...(out ? {} : { opacity: { duration: 0.5, delay: base + d.delay, times: [0, 0.8, 1] } }),
          }}
        />
      ))}
    </div>,
    document.body,
  );
}

export default Poof;
