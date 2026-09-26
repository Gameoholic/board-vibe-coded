import { useCallback, useState } from "react";

// A card's free-canvas placement: top-left position (x,y), box size (w,h), and a stacking
// order (z) so the last-touched card floats above its neighbours when they overlap. All in
// unscaled world pixels; the camera (BoardCanvas) owns zoom, not these numbers.
export interface CardLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

// Per-device knobs for how the canvas behaves — see CanvasSettingsMenu (the top-bar popover).
// Kept alongside layouts because both are device-local preferences, not shared board state.
export interface CanvasSettings {
  snap: boolean; // settle a moved/resized card onto the grid instead of leaving it exactly where dropped
  gridSize: number; // the grid step (world px) — drives both snapping and the visible grid
  showGrid: boolean; // paint a faint dot grid on the canvas as a placement guide
}

const DEFAULT_SETTINGS: CanvasSettings = { snap: true, gridSize: 20, showGrid: false };

// Per-tab view preferences — how one tab's items are sorted and which optional row extras show.
// Device-local like layouts/settings (a display transform, not board truth), keyed by tab id (board
// and shop tabs alike). Both halves are tab-kind agnostic: `sortMode` is whatever mode that kind's
// Sort menu offers, and `display` maps that kind's Display option keys to on/off (see TabControls —
// an absent key falls back to the option's default).
export interface TabPrefs {
  sortMode: string;
  display: Record<string, boolean>;
}

export const DEFAULT_TAB_PREFS: TabPrefs = { sortMode: "manual", display: {} };

// Tab prefs saved before `display` existed carried the task tab's two toggles as fields. Normalise on
// read (never reject a saved config): fold them into the display map under the task tab's keys.
function normalizeTabPrefs(raw: Record<string, unknown>): TabPrefs {
  const display = (raw.display as Record<string, boolean> | undefined) ?? {
    ...(typeof raw.showEstimate === "boolean" ? { estimate: raw.showEstimate } : {}),
    ...(typeof raw.showTimer === "boolean" ? { timer: raw.showTimer } : {}),
  };
  return { sortMode: typeof raw.sortMode === "string" ? raw.sortMode : DEFAULT_TAB_PREFS.sortMode, display };
}

// Which sort modes show in a task tab's Sort menu without expanding "Show more". A single global
// set (not per-tab) so the menu is curated once. The rest stay one tap away under Show more.
const DEFAULT_PINNED_SORTS = ["manual", "quick"];

interface LocalConfig {
  layouts: Record<string, CardLayout>;
  settings: CanvasSettings;
  tabPrefs: Record<string, TabPrefs>;
  pinnedSorts: string[];
}

const KEY = "board-config";

function load(): LocalConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Spread the stored values over the defaults so a missing key (or a stale pre-settings
      // config) fills in rather than reading as undefined; settings merges the same way.
      const tabPrefs = Object.fromEntries(
        Object.entries((parsed.tabPrefs ?? {}) as Record<string, Record<string, unknown>>).map(([id, p]) => [
          id,
          normalizeTabPrefs(p),
        ]),
      );
      return {
        layouts: {},
        pinnedSorts: DEFAULT_PINNED_SORTS,
        ...parsed,
        tabPrefs,
        settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      };
    }
  } catch {}
  return { layouts: {}, settings: DEFAULT_SETTINGS, tabPrefs: {}, pinnedSorts: DEFAULT_PINNED_SORTS };
}

function save(config: LocalConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {}
}

export function useLocalConfig() {
  const [config, setConfig] = useState<LocalConfig>(load);

  const setCardLayout = useCallback((sectionId: string, layout: CardLayout | null) => {
    setConfig((prev) => {
      const next: LocalConfig = { ...prev, layouts: { ...prev.layouts } };
      if (layout === null) {
        delete next.layouts[sectionId];
      } else {
        next.layouts[sectionId] = layout;
      }
      save(next);
      return next;
    });
  }, []);

  const setSettings = useCallback((patch: Partial<CanvasSettings>) => {
    setConfig((prev) => {
      const next: LocalConfig = { ...prev, settings: { ...prev.settings, ...patch } };
      save(next);
      return next;
    });
  }, []);

  const setTabPref = useCallback((sectionId: string, patch: Partial<TabPrefs>) => {
    setConfig((prev) => {
      const current = prev.tabPrefs[sectionId] ?? DEFAULT_TAB_PREFS;
      const next: LocalConfig = {
        ...prev,
        tabPrefs: { ...prev.tabPrefs, [sectionId]: { ...current, ...patch } },
      };
      save(next);
      return next;
    });
  }, []);

  // Pin or unpin a sort mode from the always-visible part of the Sort menu (global across tabs).
  const togglePinnedSort = useCallback((mode: string) => {
    setConfig((prev) => {
      const pinnedSorts = prev.pinnedSorts.includes(mode)
        ? prev.pinnedSorts.filter((m) => m !== mode)
        : [...prev.pinnedSorts, mode];
      const next: LocalConfig = { ...prev, pinnedSorts };
      save(next);
      return next;
    });
  }, []);

  // Wipe the given cards' saved placements so they fall back to their tidy default grid
  // (defaultLayout) — one canvas's cards at a time, so resetting the shop leaves the board as it was.
  // Device-local only — it never touches the server, so it's a safe "put my tabs back" escape hatch.
  const resetLayouts = useCallback((ids: string[]) => {
    setConfig((prev) => {
      const layouts = { ...prev.layouts };
      for (const id of ids) delete layouts[id];
      const next: LocalConfig = { ...prev, layouts };
      save(next);
      return next;
    });
  }, []);

  return { config, setCardLayout, setSettings, setTabPref, togglePinnedSort, resetLayouts };
}

export type LocalConfigApi = ReturnType<typeof useLocalConfig>;
