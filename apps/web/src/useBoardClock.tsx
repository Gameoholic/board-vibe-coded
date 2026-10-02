import { DEFAULT_SETTINGS } from "@board/contracts";
import { createContext, useContext } from "react";
import type { Settings } from "./types";

// The board's effective "now" (debug-pinned or real) plus the board Settings (timezone / week start)
// reach the places that gate on scheduled time — TaskItem, to lock scheduled boxes (see isBoxLocked),
// and SectionCard, whose "Get done quick" sort sinks not-yet-unlockable tasks — through a context
// rather than prop-drilling. Read via the hook, never the context directly (frontend React
// convention). A `now` tick (~1/min) re-renders those consumers; motion values persist, so card
// layout is untouched, and a task that has just unlocked slides up the quick sort on the next tick.
export interface BoardClock {
  now: string;
  settings: Settings;
  // The board's open day: one not yet ended is still today, whatever `now` says (see isBoxLocked).
  openDay?: string;
}

const BoardClockContext = createContext<BoardClock>({
  now: new Date().toISOString(),
  settings: DEFAULT_SETTINGS,
});

export const BoardClockProvider = BoardClockContext.Provider;

export function useBoardClock(): BoardClock {
  return useContext(BoardClockContext);
}
