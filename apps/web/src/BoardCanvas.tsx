import { motion } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { clampScale, ZOOM_STEP } from "./canvas";
import { ScaleProvider } from "./useCanvasScale";
import { useCanvasSettings } from "./useCanvasSettings";

interface BoardCanvasProps {
  // Which canvas this is ("board", "shop") — stamped as data-canvas on the viewport so styles and DOM
  // queries can target one canvas's cards when two are mounted at once.
  name: string;
  // World size in unscaled px: the cards' bounding box already padded with slack. The camera
  // never lets you pan or zoom past this, so the reachable area is exactly "the tabs + margin"
  // and grows only when a card is dropped further out.
  worldW: number;
  worldH: number;
  children: React.ReactNode;
}

function BoardCanvas({ name, worldW, worldH, children }: BoardCanvasProps) {
  const { showGrid, gridSize } = useCanvasSettings();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  // Live scale for the pointer-gesture closures (they capture the scale at pinch-start without
  // re-subscribing). Mirrors the state; written every render.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  // Where to leave the scrollbars after a zoom so the point under the cursor stays put. Applied
  // in a layout effect once the scaler has resized, then cleared.
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);

  // Active dragging pointers (touch fingers, or the middle mouse button). One → pan; two → pinch.
  // The gesture callbacks below read these refs so a finger going up/down mid-gesture just changes
  // the count, never re-subscribes a listener. panBase is the scroll+pointer baseline a pan drags
  // from; pinchBase is the finger distance + scale a pinch scales from.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const panBase = useRef({ left: 0, top: 0, x: 0, y: 0 });
  const pinchBase = useRef<{ dist: number; scale: number } | null>(null);

  const clampScroll = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    vp.scrollLeft = Math.max(0, Math.min(vp.scrollLeft, vp.scrollWidth - vp.clientWidth));
    vp.scrollTop = Math.max(0, Math.min(vp.scrollTop, vp.scrollHeight - vp.clientHeight));
  }, []);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (vp && pendingScroll.current) {
      vp.scrollLeft = pendingScroll.current.left;
      vp.scrollTop = pendingScroll.current.top;
      pendingScroll.current = null;
    }
    clampScroll();
  }, [scale, worldW, worldH, clampScroll]);

  // Re-scale the world around an anchor point (in viewport-local px), keeping whatever's under
  // that anchor fixed on screen — the shared core of both wheel zoom (anchor = cursor) and the
  // button controls (anchor = viewport centre). `compute` maps the previous scale to a raw target;
  // it's clamped here. The post-zoom scroll is deferred to the layout effect (scaler must resize first).
  const zoom = useCallback((compute: (prev: number) => number, anchor?: { x: number; y: number }) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const px = anchor ? anchor.x - rect.left : rect.width / 2;
    const py = anchor ? anchor.y - rect.top : rect.height / 2;
    setScale((prev) => {
      const next = clampScale(compute(prev));
      if (next === prev) return prev;
      const worldX = (vp.scrollLeft + px) / prev;
      const worldY = (vp.scrollTop + py) / prev;
      pendingScroll.current = { left: worldX * next - px, top: worldY * next - py };
      return next;
    });
  }, []);

  // Zoom on ctrl/⌘+wheel (trackpad pinch sends exactly this), anchored on the cursor. Plain
  // wheel is left alone so it scrolls/pans the viewport natively. Attached non-passively
  // because we must preventDefault to stop the browser's own page zoom.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoom((prev) => prev * (1 - e.deltaY * 0.0015), { x: e.clientX, y: e.clientY });
    }
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [zoom]);

  // Re-seed the pan/pinch baselines for however many fingers are now down — called after every
  // pointer add/remove so lifting one finger of a pinch smoothly continues as a pan (and vice
  // versa) with no jump. Two fingers capture the current distance + scale (pinch); one captures
  // the current scroll + pointer (pan).
  const rebaseline = useCallback(() => {
    const vp = viewportRef.current;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      const [a, b] = pts;
      pinchBase.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: scaleRef.current };
    } else {
      pinchBase.current = null;
      if (pts.length === 1 && vp) {
        panBase.current = { left: vp.scrollLeft, top: vp.scrollTop, x: pts[0].x, y: pts[0].y };
      }
    }
  }, []);

  // One move handler for the whole gesture: two fingers pinch (reusing `zoom`, anchored on the
  // midpoint), one finger/middle-mouse pans (scroll follows the pointer). Same zoom and scroll
  // code the wheel and buttons use — mobile adds gesture recognition, not new zoom/pan behaviour.
  const onGestureMove = useCallback(
    (e: PointerEvent) => {
      const vp = viewportRef.current;
      const p = pointers.current.get(e.pointerId);
      if (!vp || !p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pinchBase.current) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const base = pinchBase.current;
        zoom(() => base.scale * (dist / base.dist), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      } else {
        vp.scrollLeft = panBase.current.left - (p.x - panBase.current.x);
        vp.scrollTop = panBase.current.top - (p.y - panBase.current.y);
      }
    },
    [zoom],
  );

  const onGestureEnd = useCallback(
    (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.delete(e.pointerId);
      rebaseline();
      if (pointers.current.size === 0) {
        viewportRef.current?.classList.remove("grabbing");
        window.removeEventListener("pointermove", onGestureMove);
        window.removeEventListener("pointerup", onGestureEnd);
        window.removeEventListener("pointercancel", onGestureEnd);
      }
    },
    [onGestureMove, rebaseline],
  );

  // Grab-to-pan / pinch-to-zoom. Left click stays free for interaction, so a mouse only grabs on the
  // MIDDLE button; touch pans one-finger and zooms two-finger (touch-action: none on the viewport
  // hands us the raw pointers, since the browser's native pinch is off). Bails when the press lands
  // on a card so card move/resize keeps its own pointer stream. preventDefault stops the browser's
  // own middle-click autoscroll.
  // ponytail: a gesture must start on empty canvas — a two-finger pinch with both fingers over a
  // card won't zoom. Fine on a whiteboard with margins; revisit if cards ever fill the screen.
  function onPanStart(e: React.PointerEvent) {
    const isMiddleMouse = e.button === 1;
    const isTouch = e.pointerType === "touch";
    if (!isMiddleMouse && !isTouch) return;
    // Touch must start on empty canvas so card drag/resize keeps its pointer stream.
    // Middle mouse pans from anywhere — tasks should not block camera movement.
    if (isTouch && (e.target as HTMLElement).closest(".board-card")) return;
    const vp = viewportRef.current;
    if (!vp) return;
    e.preventDefault();
    const first = pointers.current.size === 0;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    rebaseline();
    if (first) {
      vp.classList.add("grabbing");
      window.addEventListener("pointermove", onGestureMove);
      window.addEventListener("pointerup", onGestureEnd);
      window.addEventListener("pointercancel", onGestureEnd);
    }
  }

  return (
    <>
    <div className="board-viewport" data-canvas={name} ref={viewportRef} onPointerDown={onPanStart}>
      <div className="board-scaler" style={{ width: worldW * scale, height: worldH * scale }}>
        {/* The scale is applied here by framer (not CSS) so it registers in framer's projection
            tree — otherwise the Reorder.Item layout animations inside measure through an
            unknown-to-framer CSS scale and spring a phantom "correction" on every re-render
            (all card text jumps for ~0.5s) whenever scale != 1. `scale`/`originX`/`originY` are
            framer transform props; origin 0,0 keeps top-left anchoring so the scroll math holds. */}
        <motion.div
          className="board-world"
          style={{
            width: worldW,
            height: worldH,
            scale,
            originX: 0,
            originY: 0,
            // A dot grid painted in world px, so it scales with the transform and stays exactly
            // aligned to where cards snap. Toggled off by default (see canvas settings).
            ...(showGrid
              ? {
                  backgroundImage: "radial-gradient(circle, #d8dee9 1px, transparent 1px)",
                  backgroundSize: `${gridSize}px ${gridSize}px`,
                }
              : null),
          }}
        >
          <ScaleProvider value={scaleRef}>{children}</ScaleProvider>
        </motion.div>
      </div>
    </div>

    {/* On-screen zoom controls — a sibling of the viewport (not inside it) so they stay pinned
        while you pan, mirroring .canvas-toolbar. For anyone without a wheel/trackpad-pinch: zoom
        out to see more, in to come back, and the % chip resets to 100%. Both buttons anchor on the
        viewport centre. */}
    <div className="zoom-controls">
      <button
        type="button"
        className="toolbar-btn"
        aria-label="Zoom out"
        onClick={() => zoom((prev) => prev / ZOOM_STEP)}
      >
        <span aria-hidden>−</span>
      </button>
      <button
        type="button"
        className="toolbar-btn zoom-level"
        aria-label="Reset zoom to 100%"
        onClick={() => zoom(() => 1)}
      >
        {Math.round(scale * 100)}%
      </button>
      <button
        type="button"
        className="toolbar-btn"
        aria-label="Zoom in"
        onClick={() => zoom((prev) => prev * ZOOM_STEP)}
      >
        <span aria-hidden>+</span>
      </button>
    </div>
    </>
  );
}

export default BoardCanvas;
