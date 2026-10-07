import { useLayoutEffect, useRef } from "react";

const GAP = 20;
const OBSTACLES = ".board-card, .add-section-anchor, .popover, .top";
const NAV = ".app-nav";

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const overlaps = (a: Box, b: Box) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

// Candidate positions come from the obstacles' own edges (flush against each side of every
// card, plus the viewport's edges and centre) rather than a sampled grid: the only places a
// box can sit "as close to centre as possible" without overlapping are pressed up against
// something, so the edge set is both smaller and exact where a grid scan would be neither.
export function findSpot(blocked: Box[], vw: number, vh: number, width: number, height: number) {
  const cx = vw / 2;
  const cy = vh / 2;

  const minX = GAP;
  const maxX = vw - width - GAP;
  const minY = GAP;
  const maxY = vh - height - GAP;
  const clampX = (v: number) => Math.min(Math.max(v, minX), maxX);
  const clampY = (v: number) => Math.min(Math.max(v, minY), maxY);

  const xs = new Set([minX, clampX(cx - width / 2), maxX]);
  const ys = new Set([minY, clampY(cy - height / 2), maxY]);
  for (const b of blocked) {
    xs.add(clampX(b.right));
    xs.add(clampX(b.left - width));
    ys.add(clampY(b.bottom));
    ys.add(clampY(b.top - height));
  }

  let best = { x: clampX(cx - width / 2), y: maxY };
  let bestScore = Infinity;
  for (const x of xs) {
    for (const y of ys) {
      const box = { left: x, top: y, right: x + width, bottom: y + height };
      if (blocked.some((b) => overlaps(box, b))) continue;
      const score = (x + width / 2 - cx) ** 2 + (y + height / 2 - cy) ** 2;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

// Parks the HUD in whichever gap in the layout is nearest the middle of the screen, so it
// never sits on top of a tab. Ref-based and rAF-throttled, same shape as useDiegeticDepth:
// the position is written straight to the node's transform, never through React state, so a
// reflow on every scroll frame can't cascade into a re-render of the board.
//
// `dock`: a selector for a slot the widget should sit centred in *instead* of free-parking, while
// that slot is in the DOM (the shop's top-centre slot for the points counter). Presence-driven, so the
// widget flies there when the slot mounts and back to a free spot once it unmounts — the transform
// transition animates both.
export function useFreeSpot(extraObstacles?: string, dock?: string) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    // A second free-floating element (e.g. the wind-down clock) passes the HUD's selector here so it
    // parks in a gap that avoids the points counter too, not just the cards.
    const selector = extraObstacles ? `${OBSTACLES}, ${extraObstacles}` : OBSTACLES;

    const apply = () => {
      frame = 0;
      const slot = dock ? document.querySelector(dock)?.getBoundingClientRect() : undefined;
      if (slot) {
        const x = slot.left + (slot.width - el.offsetWidth) / 2;
        const y = slot.top + (slot.height - el.offsetHeight) / 2;
        el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
        return;
      }
      const vw = window.innerWidth;
      // On a phone the rail of places lies along the foot of the screen: the widget parks above it, never
      // on it. (As the left rail it starts at the top, and takes no height.)
      const navTop = document.querySelector(NAV)?.getBoundingClientRect().top ?? 0;
      const vh = navTop > 0 ? navTop : window.innerHeight;
      const blocked = Array.from(document.querySelectorAll(selector))
        .map((node) => node.getBoundingClientRect())
        .filter((r) => r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh)
        .map((r) => ({
          left: r.left - GAP,
          top: r.top - GAP,
          right: r.right + GAP,
          bottom: r.bottom + GAP,
        }));
      const { x, y } = findSpot(blocked, vw, vh, el.offsetWidth, el.offsetHeight);
      el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    // First placement runs synchronously, before the browser paints, so the widget never
    // shows up at its untranslated top-left origin for a frame and never animates in from
    // there (a transform set before the first paint has no previous value to transition from).
    apply();

    window.addEventListener("resize", schedule);
    // capture: true so panning the board — which scrolls .board-viewport's own overflow, not the
    // window — still re-runs placement. scroll doesn't bubble, but it does reach the capture phase,
    // so a window-level capturing listener catches the inner scroller the plain listener missed.
    window.addEventListener("scroll", schedule, { passive: true, capture: true });

    // <main> is always present (it wraps the loading state too) and sits outside the HUD, so
    // observing it catches tabs appearing, resizing, reordering, tasks being added and
    // popovers opening — without picking up the HUD's own per-frame transform writes.
    const observer = new MutationObserver(schedule);
    const main = document.querySelector("main");
    if (main) {
      observer.observe(main, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class"],
      });
    }

    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, { capture: true });
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [extraObstacles, dock]);

  return ref;
}
