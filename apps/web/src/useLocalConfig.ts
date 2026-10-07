import { useCallback, useState } from "react";
import { PHONE_SCREEN } from "./usePhoneScreen";

// A card's free-canvas placement: top-left position (x,y), box size (w,h), and a stacking
// order (z) so the last-touched card floats above its neighbours when they overlap. All in
// unscaled world pixels; the camera (BoardCanvas) owns zoom, not these numbers.
export interface CardLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  // Sized by hand: `h` is the card's height and its list scrolls inside it. Until then `h` is only a floor,
  // and the card grows to fit what it lists.
  fixed?: boolean;
}

// Per-device knobs for how the canvas behaves — see CanvasSettingsMenu (the top-bar popover).
// Kept alongside layouts because both are device-local preferences, not shared board state.
export interface CanvasSettings {
  snap: boolean; // settle a moved/resized card onto the grid instead of leaving it exactly where dropped
  gridSize: number; // the grid step (world px) — drives both snapping and the visible grid
  showGrid: boolean; // paint a faint dot grid on the canvas as a placement guide
  oneTab: boolean; // show one tab at a time, filling the screen, instead of the free canvas
}

// A phone-sized screen starts in the one-tab view: a canvas of tabs each as wide as the screen is all
// panning there.
export const DEFAULT_SETTINGS: CanvasSettings = {
  snap: true,
  gridSize: 20,
  showGrid: false,
  oneTab: typeof window !== "undefined" && window.matchMedia(PHONE_SCREEN).matches,
};

// Per-tab view preferences — how one tab's items are sorted, which optional row extras show, and which
// menu options sit up front. Device-local like layouts/settings (a display transform, not board truth),
// keyed by tab id (board and shop tabs alike). All tab-kind agnostic: `sortMode` is whatever key that tab's
// Sort menu offers, `display` maps its Display keys to on/off, and `pinned` maps "sort:<key>" /
// "display:<key>" to pinned or not (see TabControls — an absent key falls back to the tab's default).
export interface TabPrefs {
  sortMode: string;
  display: Record<string, boolean>;
  pinned?: Record<string, boolean>;
  // The broken-down tasks whose pieces are folded away, by id. Absent ≡ every one shows its pieces.
  collapsed?: string[];
}

export const DEFAULT_TAB_PREFS: TabPrefs = { sortMode: "manual", display: {} };

// Tab prefs saved before `display` existed carried the task tab's two toggles as fields. Normalise on
// read (never reject a saved config): fold them into the display map under the task tab's keys.
function normalizeTabPrefs(raw: Record<string, unknown>): TabPrefs {
  const display = (raw.display as Record<string, boolean> | undefined) ?? {
    ...(typeof raw.showEstimate === "boolean" ? { estimate: raw.showEstimate } : {}),
    ...(typeof raw.showTimer === "boolean" ? { timer: raw.showTimer } : {}),
  };
  const collapsed = Array.isArray(raw.collapsed) ? raw.collapsed.filter((id): id is string => typeof id === "string") : undefined;
  const pinned = raw.pinned && typeof raw.pinned === "object" ? (raw.pinned as Record<string, boolean>) : undefined;
  return {
    sortMode: typeof raw.sortMode === "string" ? raw.sortMode : DEFAULT_TAB_PREFS.sortMode,
    display,
    ...(pinned ? { pinned } : {}),
    ...(collapsed ? { collapsed } : {}),
  };
}

interface LocalConfig {
  layouts: Record<string, CardLayout>;
  settings: CanvasSettings;
  tabPrefs: Record<string, TabPrefs>;
  // The tab each canvas's one-tab view is on, by canvas name ("board", "shop"). Absent ≡ its first.
  shownTabs: Record<string, string>;
}

const KEY = "board-config";

function load(): LocalConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Spread the stored values over the defaults so a missing key (or a stale pre-settings
      // config) fills in rather than reading as undefined; settings merges the same way. The one
      // board-wide set of pinned sorts (`pinnedSorts`) was replaced by each tab's own pins, so it's dropped.
      delete parsed.pinnedSorts;
      const tabPrefs = Object.fromEntries(
        Object.entries((parsed.tabPrefs ?? {}) as Record<string, Record<string, unknown>>).map(([id, p]) => [
          id,
          normalizeTabPrefs(p),
        ]),
      );
      return {
        layouts: {},
        shownTabs: {},
        ...parsed,
        tabPrefs,
        settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      };
    }
  } catch {}
  return { layouts: {}, settings: DEFAULT_SETTINGS, tabPrefs: {}, shownTabs: {} };
}

function save(config: LocalConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {}
}

// Where each canvas's camera was left: its zoom, and the world point at the viewport's top-left (world
// px, so it's independent of the zoom). Device-local like layouts, keyed by canvas name ("board", "shop").
// Kept out of the LocalConfig state on purpose: it's written on every pan and only read when a canvas
// mounts, so routing it through React state would re-render the whole board on each scroll.
export interface Camera {
  scale: number;
  x: number;
  y: number;
}

const CAMERA_KEY = "board-camera";

function loadCameras(): Record<string, Camera> {
  try {
    const raw = localStorage.getItem(CAMERA_KEY);
    if (raw) return JSON.parse(raw) as Record<string, Camera>;
  } catch {}
  return {};
}

export function loadCamera(name: string): Camera | null {
  const cam = loadCameras()[name];
  const valid = cam && [cam.scale, cam.x, cam.y].every((n) => typeof n === "number" && Number.isFinite(n));
  return valid ? cam : null;
}

export function saveCamera(name: string, camera: Camera) {
  try {
    localStorage.setItem(CAMERA_KEY, JSON.stringify({ ...loadCameras(), [name]: camera }));
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

  const setShownTab = useCallback((canvas: string, tabId: string) => {
    setConfig((prev) => {
      const next: LocalConfig = { ...prev, shownTabs: { ...prev.shownTabs, [canvas]: tabId } };
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

  return { config, setCardLayout, setSettings, setTabPref, setShownTab, resetLayouts };
}

export type LocalConfigApi = ReturnType<typeof useLocalConfig>;
