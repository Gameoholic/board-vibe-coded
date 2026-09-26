import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  titleExtra?: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  align?: "left" | "right";
  // Tall forms (add-task, streak) opt in: cap the panel to the space available in its clip container
  // and scroll internally rather than overflow past an edge. Off by default so short popovers that
  // hold nested absolute popovers (color picker, timer) aren't given an overflow that would clip them.
  scrollable?: boolean;
}

// The nearest ancestor that clips overflow — inside the board that's `.board-viewport`, which starts
// below the date header, so the window is the wrong reference for how much room is really above/below.
function clipContainer(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p) {
    const overflowY = getComputedStyle(p).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden") return p;
    p = p.parentElement;
  }
  return null;
}

function Popover({ open, onClose, title, titleExtra, children, width = 280, align = "left", scrollable = false }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [openUp, setOpenUp] = useState(false);
  const [maxH, setMaxH] = useState<number | undefined>(undefined);
  // Extra pull (px) back toward the clip so a scrollable panel that would overflow the viewport edge
  // slides onto screen instead of scrolling. 0 for the plain anchored placement.
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    const anchor = el?.parentElement;
    if (!el || !anchor) return;

    const margin = 6;
    // Re-measured on open and whenever the panel's own height changes (switching task type, adding
    // tiers), so it always claims the room it can and only scrolls when it truly can't fit.
    const measure = () => {
      const anchorRect = anchor.getBoundingClientRect();
      // Measure room against the clip container (falls back to the window). All in screen px, so
      // canvas zoom is fine.
      const clip = clipContainer(anchor);
      const clipTop = clip ? clip.getBoundingClientRect().top : 0;
      const clipBottom = clip ? clip.getBoundingClientRect().bottom : window.innerHeight;

      if (!scrollable) {
        // Plain popovers sit on whichever side of the anchor has more room; no height cap (they may
        // hold nested absolute popovers, so an overflow would clip those).
        const popH = el.getBoundingClientRect().height;
        const spaceBelow = clipBottom - anchorRect.bottom - margin;
        const spaceAbove = anchorRect.top - clipTop - margin;
        setOpenUp(spaceBelow < popH && spaceAbove > spaceBelow);
        setMaxH(undefined);
        setShift(0);
        return;
      }

      // Scrollable forms may use the FULL clip height, not just the gap on one side of the anchor —
      // so a short form never scrolls just because the anchor sits mid-viewport.
      const avail = Math.max(120, clipBottom - clipTop - margin * 2);
      setMaxH(avail);
      const h = Math.min(el.getBoundingClientRect().height, avail);
      const spaceBelow = clipBottom - anchorRect.bottom - margin;
      const spaceAbove = anchorRect.top - clipTop - margin;
      const up = spaceBelow < h && spaceAbove > spaceBelow;
      setOpenUp(up);

      // If the panel would spill past the clip edge, pull it back by the overflow — but never so far
      // that its other end leaves the clip. This keeps the whole panel visible without scrolling.
      let s = 0;
      if (up) {
        const overflow = clipTop + margin - (anchorRect.top - margin - h);
        if (overflow > 0) s = Math.min(overflow, clipBottom - anchorRect.top);
      } else {
        const overflow = anchorRect.bottom + margin + h - (clipBottom - margin);
        if (overflow > 0) s = Math.min(overflow, anchorRect.bottom - clipTop);
      }
      setShift(s);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, scrollable]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          className="popover"
          style={{
            width,
            [align]: 0,
            ...(scrollable ? { maxHeight: maxH, overflowY: "auto" } : {}),
            ...(openUp
              ? { top: "auto", bottom: `calc(100% + ${6 - shift}px)`, transformOrigin: "bottom" }
              : { top: `calc(100% + ${6 - shift}px)`, bottom: "auto", transformOrigin: "top" }),
          }}
          initial={{ opacity: 0, scale: 0.96, y: openUp ? 6 : -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: openUp ? 4 : -4 }}
          transition={{ duration: 0.14, ease: "easeOut" }}
        >
          <div className="popover-header">
            <span className="popover-title">{title}</span>
            {titleExtra}
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              ✕
            </button>
          </div>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default Popover;
