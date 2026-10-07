import { animate, motion, useMotionValue } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MIN_H, MIN_W, snap } from "./canvas";
import Popover from "./Popover";
import { useCanvasScale } from "./useCanvasScale";
import { useCanvasSettings } from "./useCanvasSettings";
import { useClickOutside } from "./useClickOutside";
import type { CardLayout } from "./useLocalConfig";

// The shared base of every tab on every canvas (the board's task/streak tabs, the shop's tabs): a
// freely-placed card you move by its header handle, resize from any corner, and bring to front by
// touching. It knows nothing about what it lists — the tab kind fills the header, body and footer.
// A card fits what it lists until it's resized; from then on it keeps the size it was given, down to
// just its header, and its list scrolls inside it when it's taller.
//
// In a canvas's one-tab view the card is docked instead: it fills the frame, with nothing to move or resize,
// and its list scrolls inside it once it's taller than the frame.

// Everything a card needs from its canvas to be placed: its saved (or default) layout, the canvas's
// "reset positions" signal, and where to persist a move/resize. Handed to each card by CardCanvas.
export interface CardFrame {
  layout: CardLayout;
  // Bumps when "reset positions" runs — the card animates back to its arranged `layout`. A signal
  // rather than reacting to `layout` directly so a normal drag/resize commit doesn't get overridden.
  resetSignal: number;
  onLayoutChange: (layout: CardLayout) => void;
  // The one-tab view: the card fills the frame rather than sitting at its layout.
  docked?: boolean;
}

// Whichever card was last grabbed floats above the rest — across every canvas. Seeded high so it
// always beats the small index-based z's that fresh (never-moved) cards carry.
let zCounter = 1000;

const settle = { type: "spring" as const, stiffness: 520, damping: 34 };

interface CanvasCardProps {
  frame: CardFrame;
  title: React.ReactNode; // header-left (typically a CardTitle)
  actions?: React.ReactNode; // header-right, after the move handle (sort, display, …)
  footer?: React.ReactNode; // below the body (typically a CardAdd)
  children: React.ReactNode; // the body — the tab's list
  className?: string; // a tab kind's own look on the card (the Freezer's ice)
}

function CanvasCard({ frame, title, actions, footer, children, className }: CanvasCardProps) {
  const { layout, resetSignal, onLayoutChange, docked = false } = frame;
  // The scale context provides a stable ref (not a reactive value) so the card doesn't re-render on
  // zoom — re-rendering would trigger Reorder.Item layout animations on every zoom step.
  const scaleRef = useCanvasScale();
  const settings = useCanvasSettings();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  if (layout.z > zCounter) zCounter = layout.z;

  // Position is a transform (x/y), size is width/height — kept as motion values so a drag moves
  // the card at 60fps with zero React renders, then springs to the snapped grid cell on release.
  const x = useMotionValue(layout.x);
  const y = useMotionValue(layout.y);
  const w = useMotionValue(layout.w);
  const h = useMotionValue(layout.h);

  // "Reset positions" bumps resetSignal; each card then springs to its freshly-arranged layout.
  // Reads the layout via its ref (updated on every render) so it lands on the current target, and
  // depends only on the signal — not `layout` — so drag/resize commits (which also change `layout`)
  // never trip it. Skips the initial mount, where the motion values already hold the right values.
  const didMountLayout = useRef(false);
  useEffect(() => {
    if (!didMountLayout.current) {
      didMountLayout.current = true;
      return;
    }
    const l = layoutRef.current;
    animate(x, l.x, settle);
    animate(y, l.y, settle);
    animate(w, l.w, settle);
    animate(h, l.h, settle);
  }, [resetSignal, x, y, w, h]);

  const fixed = layout.fixed === true;
  const cardRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const overflows = useOverflows(bodyRef, contentRef, fixed || docked);

  function bringToFront() {
    onLayoutChange({ ...layoutRef.current, z: ++zCounter });
  }

  // Touching a card floats it above its neighbours so its popovers can't be covered by an
  // overlapping tab. Skipped when it's already on top so a plain click doesn't churn storage.
  function focusCard() {
    if (layoutRef.current.z < zCounter) bringToFront();
  }

  // Persist where the card now is, settling on whole px. A move snaps its position to the grid (canvas
  // settings) and springs there — on the same motion values the drag was writing, so there's no jump
  // between "let go" and "settled"; with snapping off it lands exactly where it was dropped. A resize
  // doesn't snap: its edges stay exactly where the pointer left them.
  function commit(snapToGrid: boolean) {
    const put = (n: number) => (snapToGrid && settings.snap ? snap(n, settings.gridSize) : Math.round(n));
    const nx = put(x.get());
    const ny = put(y.get());
    const nw = Math.round(w.get());
    const nh = Math.round(h.get());
    animate(x, nx, settle);
    animate(y, ny, settle);
    animate(w, nw, settle);
    animate(h, nh, settle);
    onLayoutChange({ ...layoutRef.current, x: nx, y: ny, w: nw, h: nh });
  }

  function startMove(e: React.PointerEvent) {
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = x.get();
    const oy = y.get();
    bringToFront();
    function onMove(ev: PointerEvent) {
      x.set(ox + (ev.clientX - sx) / scaleRef.current);
      y.set(oy + (ev.clientY - sy) / scaleRef.current);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      commit(true);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // xSign/ySign: +1 = this corner drives the right/bottom edge (grow by dragging out), -1 = the
  // left/top edge (the edge follows the pointer, so x/y move while width/height shrink to match).
  function startResize(e: React.PointerEvent, xSign: 1 | -1, ySign: 1 | -1) {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = x.get();
    const oy = y.get();
    const ow = w.get();
    // A card that still fits its list may be taller than its floor: the drag starts from the height it shows,
    // which is the height it keeps from now on.
    const oh = fixed ? h.get() : (cardRef.current?.offsetHeight ?? h.get());
    h.set(oh);
    // Into the ref at once too, so a release before the next render still commits it as sized.
    layoutRef.current = { ...layoutRef.current, z: ++zCounter, h: oh, fixed: true };
    onLayoutChange(layoutRef.current);
    // Shrinking past where the list fits takes Shift; without it the card stops there (or where it started, if
    // it was already shorter). The fit is the list's top, the list, then the card's bottom padding and border —
    // never the room a taller card leaves empty under its list — read each time, since a narrower card's rows
    // can wrap taller.
    const minH = (shift: boolean) => {
      const card = cardRef.current;
      const body = bodyRef.current;
      const content = contentRef.current;
      if (shift || !card || !body || !content) return MIN_H;
      const style = getComputedStyle(card);
      const fit = card.clientTop + body.offsetTop + content.offsetHeight + parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth);
      return Math.max(MIN_H, Math.min(oh, fit));
    };
    // How far from the edges it moves the pointer took hold (the grab area reaches past the corner): the edges
    // go to the pointer on the first move and stay under it.
    const rect = cardRef.current?.getBoundingClientRect();
    const gx = rect ? (sx - (xSign === 1 ? rect.right : rect.left)) / scaleRef.current : 0;
    const gy = rect ? (sy - (ySign === 1 ? rect.bottom : rect.top)) / scaleRef.current : 0;
    function onMove(ev: PointerEvent) {
      const dx = (ev.clientX - sx) / scaleRef.current + gx;
      const dy = (ev.clientY - sy) / scaleRef.current + gy;
      if (xSign === 1) {
        w.set(Math.max(MIN_W, ow + dx));
      } else {
        const nw = Math.max(MIN_W, ow - dx);
        w.set(nw);
        x.set(ox + (ow - nw));
      }
      const least = minH(ev.shiftKey);
      if (ySign === 1) {
        h.set(Math.max(least, oh + dy));
      } else {
        const nh = Math.max(least, oh - dy);
        h.set(nh);
        y.set(oy + (oh - nh));
      }
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      commit(false);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <motion.section
      ref={cardRef}
      className={`board-card${docked ? " docked" : ""}${className ? ` ${className}` : ""}`}
      // Both sizes are always set, so turning sized can't leave the old floor behind on the element. Docked,
      // its place and size are the frame's (App.css).
      style={docked ? undefined : { x, y, width: w, height: fixed ? h : "auto", minHeight: fixed ? 0 : h, zIndex: layout.z }}
      onPointerDown={docked ? undefined : focusCard}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
    >
      {!docked && (
        <>
          <span className="resize-corner corner-nw" onPointerDown={(e) => startResize(e, -1, -1)} />
          <span className="resize-corner corner-ne" onPointerDown={(e) => startResize(e, 1, -1)} />
          <span className="resize-corner corner-sw" onPointerDown={(e) => startResize(e, -1, 1)} />
          <span className="resize-corner corner-se" onPointerDown={(e) => startResize(e, 1, 1)} />
        </>
      )}

      <div className="board-card-header">
        <div className="header-left">{title}</div>
        <div className="header-right">
          {!docked && (
            <span className="drag-handle section-drag-handle" aria-label="Drag to move tab" onPointerDown={startMove}>
              ⠿
            </span>
          )}
          {actions}
        </div>
      </div>

      {/* layoutScroll: the rows' layout animations measure through this list's scroll. */}
      <motion.div ref={bodyRef} className={`board-card-body${overflows ? " overflows" : ""}`} layoutScroll>
        <div ref={contentRef}>
          {children}
          {!docked && footer}
        </div>
      </motion.div>
      {/* Docked, the footer stays put under the list: a long tab's add button isn't a scroll away. */}
      {docked && footer && <div className="board-card-footer">{footer}</div>}
    </motion.section>
  );
}

// Whether a sized card's list is taller than the room the card leaves it — only then does it scroll. A list
// that fits doesn't clip, so a row's hover bubbles can still reach past the list's edges.
function useOverflows(
  bodyRef: React.RefObject<HTMLDivElement | null>,
  contentRef: React.RefObject<HTMLDivElement | null>,
  fixed: boolean,
): boolean {
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const content = contentRef.current;
    if (!fixed || !body || !content) {
      setOverflows(false);
      return;
    }
    const check = () => setOverflows(content.offsetHeight > body.clientHeight + 1);
    const ro = new ResizeObserver(check);
    ro.observe(body);
    ro.observe(content);
    check();
    return () => ro.disconnect();
  }, [bodyRef, contentRef, fixed]);
  return overflows;
}

// The tab's coloured name, which opens the tab's own popover (the board: its colour; the shop: its
// name/colour/delete settings) — one component so every tab's title behaves identically.
export function CardTitle({
  name,
  color,
  popoverTitle,
  popoverWidth,
  children,
}: {
  name: string;
  color: string;
  popoverTitle: string;
  popoverWidth: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  return (
    <div className="popover-anchor" ref={ref}>
      <button type="button" className="section-title" style={{ color }} onClick={() => setOpen((v) => !v)}>
        {name}
      </button>
      <Popover title={popoverTitle} open={open} onClose={() => setOpen(false)} align="left" width={popoverWidth}>
        {children}
      </Popover>
    </div>
  );
}

// The "+" at the foot of a tab that opens its add form: always shown, or hidden until the pointer is on
// its row (the tab's Display option — see addButtonOption). The form (usually a Popover) is the tab
// kind's, rendered with the open state and a close callback.
export function CardAdd({
  label,
  shown = false,
  children,
}: {
  label: string;
  shown?: boolean;
  children: (open: boolean, close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useClickOutside(ref, close, open);
  return (
    <div className={`popover-anchor add-item-anchor${open ? " add-open" : ""}${shown ? " shown" : ""}`} ref={ref}>
      <button type="button" className="add-item-fab" aria-label={label} onClick={() => setOpen((v) => !v)}>
        +
      </button>
      {children(open, close)}
    </div>
  );
}

export default CanvasCard;
