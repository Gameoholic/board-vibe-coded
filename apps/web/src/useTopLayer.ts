import { useLayoutEffect, useState } from "react";

// Panels that open from inside a tab — a row's edit form, a delete confirm, a tab's sort menu — are shown in
// the browser's top layer (the Popover API: the element carries `popover="manual"`). There nothing can clip
// or cover them: not a tab's list scrolling under them, not their card, not the canvas. They stay where they
// are in the DOM, so a click inside one still counts as inside its anchor, and its styles still apply.

const GAP = 6; // between a panel and its anchor
const EDGE = 8; // the closest a panel comes to the window's edges

/** Shows `ref`'s element (a `popover="manual"` element) in the top layer while `open`. It leaves the top
 *  layer by itself when it unmounts, so an exit animation still plays there. */
export function useTopLayer(ref: React.RefObject<HTMLElement | null>, open: boolean): void {
  useLayoutEffect(() => {
    const el = ref.current;
    // StrictMode runs this twice, and showing a popover that's already shown throws.
    if (open && el && !el.matches(":popover-open")) el.showPopover();
  }, [ref, open]);
}

interface PanelPlacement {
  // Opened above its anchor (no room below), for the side its animation grows from.
  openUp: boolean;
  // A scrollable panel's most height: the window's, less its edges.
  maxH?: number;
}

/**
 * Shows `ref`'s element in the top layer while `open`, beside its anchor — the element it sits in — on
 * whichever side has room, left-aligned to it or right-aligned, and slid back onto the screen where it would
 * spill off. The top layer is screen space, so it's placed from the anchor's on-screen box, and every frame
 * while open: the list scrolls, the board pans and zooms, and rows move under it. (Being screen space, the
 * canvas zoom doesn't shrink it either.) A `scrollable` panel is capped to the window and scrolls inside.
 */
export function useAnchoredPanel(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  { align = "left", scrollable = false }: { align?: "left" | "right"; scrollable?: boolean } = {},
): PanelPlacement {
  const [openUp, setOpenUp] = useState(false);
  const [maxH, setMaxH] = useState<number | undefined>(undefined);
  useTopLayer(ref, open);

  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    const anchor = el?.parentElement;
    if (!el || !anchor) return;
    let frame = 0;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const room = window.innerHeight - EDGE * 2;
      const h = scrollable ? Math.min(el.offsetHeight, room) : el.offsetHeight;
      const below = window.innerHeight - EDGE - GAP - a.bottom;
      const above = a.top - GAP - EDGE;
      const up = below < h && above > below;
      const top = up ? a.top - GAP - h : a.bottom + GAP;
      const left = align === "left" ? a.left : a.right - el.offsetWidth;
      el.style.top = `${Math.max(EDGE, Math.min(top, window.innerHeight - EDGE - h))}px`;
      el.style.left = `${Math.max(EDGE, Math.min(left, window.innerWidth - EDGE - el.offsetWidth))}px`;
      setOpenUp(up);
      if (scrollable) setMaxH(room);
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [ref, open, align, scrollable]);

  return { openUp, maxH };
}
