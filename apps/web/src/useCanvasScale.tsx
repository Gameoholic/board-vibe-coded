import { createContext, useContext } from "react";
import type { MutableRefObject } from "react";

// Cards live inside a CSS-scaled world, so a drag/resize measured in screen pixels must be
// divided by the current zoom to become world pixels. The camera owns the scale; cards read
// it through this hook (never the context directly — see the frontend React convention).
//
// The context holds a STABLE REF (not the scale value directly) so that SectionCard and other
// consumers don't re-render when the zoom level changes. Re-rendering on zoom would cause every
// Reorder.Item's layout animation to fire (framer measures "moved" items after a parent
// re-render) — the "all text jumps on zoom" bug. Drag/resize handlers read scaleRef.current at
// event time, so they always get the latest value without needing a re-render.
const ScaleContext = createContext<MutableRefObject<number>>({ current: 1 });

export const ScaleProvider = ScaleContext.Provider;

export function useCanvasScale(): MutableRefObject<number> {
  return useContext(ScaleContext);
}
