import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The After Effects–style pick-whip: press a handle and drag a line onto a task row anywhere on the
// board to link that task. Every task row carries data-task-id, and hit-testing is elementFromPoint in
// *screen* coordinates, so the canvas zoom/pan needs no correction. Shared by the streak form (the
// tasks a streak counts) and the Blocked form (the task one waits on): the caller says what a point on
// the board resolves to and what dropping there does; the drag, the line and the row highlight are here.

// Neutral ink for the line — deliberately not an accent colour (the streak's colour read as red). A theme
// token, so it stays visible on a dark board; that's why the line below sets its colours through `style`.
const WHIP_COLOR = "var(--ink-soft)";
// A target that's already linked: the line and the row turn amber, and dropping updates the link.
const DUPE_COLOR = "#f59e0b";
// A target that can't be linked: the line and the row turn red, the reason rides the line's end, and
// dropping there does nothing.
const REFUSED_COLOR = "#ef4444";

export interface WhipTarget {
  id: string; // the task under the pointer
  cx: number; // where the line lands (a box, the checkbox or the row), in screen space
  cy: number;
  dupe?: boolean;
  // Why this task can't be linked (shown at the line's end); absent ≡ it can.
  refused?: string;
  // Preview-fill the row's boxes up to this index while hovering (Infinity ≡ every box); absent ≡ none.
  fillUpTo?: number;
}

interface WhipState<T extends WhipTarget> {
  sx: number; // the handle
  sy: number;
  x: number; // the pointer
  y: number;
  target: T | null;
}

const clearBodyDrag = () => {
  document.body.classList.remove("whip-dragging");
  document.body.style.removeProperty("--whip-color");
};

export function usePickWhip<T extends WhipTarget>(
  resolve: (x: number, y: number) => T | null,
  onDrop: (target: T) => void,
) {
  const [whip, setWhip] = useState<WhipState<T> | null>(null);
  // The drag runs on window listeners set up at press time; they read the caller's latest callbacks
  // through refs (synced after each render) instead of the ones captured then.
  const resolveRef = useRef(resolve);
  const dropRef = useRef(onDrop);
  useLayoutEffect(() => {
    resolveRef.current = resolve;
    dropRef.current = onDrop;
  });
  const hoverRowRef = useRef<HTMLElement | null>(null);

  // Safety net: unmounting mid-drag (the form's popover closing) drops the drag styling on <body>.
  useEffect(() => clearBodyDrag, []);

  function start(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    document.body.classList.add("whip-dragging");
    document.body.style.setProperty("--whip-color", WHIP_COLOR);
    setWhip({ sx: r.left + r.width / 2, sy: r.top + r.height / 2, x: e.clientX, y: e.clientY, target: null });

    const clearHighlight = () => {
      const row = hoverRowRef.current;
      row?.classList.remove("whip-target", "whip-target-dupe", "whip-target-refused");
      row?.querySelectorAll<HTMLElement>(".whip-box-fill").forEach((el) => el.classList.remove("whip-box-fill"));
    };

    const move = (ev: PointerEvent) => {
      const target = resolveRef.current(ev.clientX, ev.clientY);
      const row = target ? document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-task-id]") ?? null : null;
      if (row !== hoverRowRef.current) {
        clearHighlight();
        hoverRowRef.current = row;
      }
      if (row && target) {
        row.classList.add("whip-target");
        row.classList.toggle("whip-target-dupe", !!target.dupe);
        row.classList.toggle("whip-target-refused", !!target.refused);
        if (target.fillUpTo !== undefined) {
          const upTo = target.fillUpTo;
          row.querySelectorAll<HTMLElement>("[data-box-index]").forEach((dot) => {
            dot.classList.toggle("whip-box-fill", Number(dot.dataset.boxIndex) <= upTo);
          });
          row.querySelector<HTMLInputElement>('input[type="checkbox"]')?.classList.add("whip-box-fill");
        }
      }
      setWhip((w) => (w ? { ...w, x: ev.clientX, y: ev.clientY, target } : w));
    };

    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      clearHighlight();
      hoverRowRef.current = null;
      clearBodyDrag();
      const target = resolveRef.current(ev.clientX, ev.clientY);
      if (target && !target.refused) dropRef.current(target);
      setWhip(null);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // The line lives in a full-viewport SVG portaled to <body>, above everything — with a refusal's reason
  // beside its end.
  const overlay = whip
    ? createPortal(
        <>
          <svg className="whip-overlay" aria-hidden="true">
            {whipLine(whip)}
          </svg>
          {whip.target?.refused && (
            <span className="whip-refusal" style={{ left: whip.target.cx + 14, top: whip.target.cy + 12 }}>
              {whip.target.refused}
            </span>
          )}
        </>,
        document.body,
      )
    : null;

  return { dragging: whip !== null, start, overlay };
}

// The drawn line. Ends on the hovered target (a magnetic snap), otherwise at the raw pointer.
function whipLine<T extends WhipTarget>(whip: WhipState<T>) {
  const ex = whip.target ? whip.target.cx : whip.x;
  const ey = whip.target ? whip.target.cy : whip.y;
  const dx = ex - whip.sx;
  const path = `M ${whip.sx} ${whip.sy} C ${whip.sx + dx * 0.4} ${whip.sy}, ${whip.sx + dx * 0.6} ${ey}, ${ex} ${ey}`;
  const stroke = whip.target?.refused ? REFUSED_COLOR : whip.target?.dupe ? DUPE_COLOR : WHIP_COLOR;
  return (
    <>
      <path d={path} fill="none" style={{ stroke }} strokeWidth={8} strokeLinecap="round" opacity={0.18} />
      <path d={path} fill="none" style={{ stroke }} strokeWidth={2} strokeLinecap="round" />
      <circle cx={ex} cy={ey} r={whip.target ? 6 : 4} style={{ fill: stroke }} />
      {whip.target && <circle cx={ex} cy={ey} r={10} fill="none" style={{ stroke }} strokeWidth={1.5} opacity={0.5} />}
    </>
  );
}
