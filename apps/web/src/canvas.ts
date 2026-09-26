import type { CardLayout } from "./useLocalConfig";

// The whole free-canvas coordinate system in one place so the card, the camera and the
// default-placement math can't drift apart.

export const GRID = 20; // snap step, in world px — everything lands on this lattice
export const MARGIN = 220; // slack around the cards you can pan/drop into, in world px
export const MIN_W = 240;
export const MIN_H = 160;

// Zoom range. You can pull well back to see more tasks at once; 1 (native) is the ceiling — this
// is a whiteboard, so zooming past 1:1 would only magnify, never reveal more. The camera still
// never wanders into empty space (the world is just the cards' bounding box + MARGIN).
export const MIN_SCALE = 0.4;
export const MAX_SCALE = 1;
// One press of the zoom-in/out buttons multiplies/divides the scale by this.
export const ZOOM_STEP = 1.2;

// grid defaults to the base GRID for placement math (defaultLayout); the live canvas passes the
// user's chosen grid size from settings so snapping follows whatever step they picked.
export function snap(n: number, grid: number = GRID): number {
  return Math.round(n / grid) * grid;
}

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

// Tidy placement for a card with no saved layout (first run) and the target the "reset positions"
// action arranges every card back to. A balanced, roughly-square grid: the column count is
// √(total) rounded up, so N tabs pack into a pleasing block rather than a fixed 3-wide strip that
// leaves a lone tab dangling. Offset by MARGIN so there's room to pan above/left of it too. The
// owner rearranges from here; it's only re-applied when they explicitly reset.
const DEFAULT_W = 320;
const DEFAULT_H = 360;
const DEFAULT_GAP = 24;
// Where the arranged block sits: a small inset from the top-left, NOT MARGIN — MARGIN is the pannable
// slack the world adds *around* the cards, and using it here shoved the whole grid down ~220px,
// leaving a big empty band above the tabs. A modest inset keeps them near the top.
const PLACE_INSET = 24;

// `top` lets a canvas start the block lower — the shop keeps its first row clear of the docked
// points counter.
export function defaultLayout(index: number, total: number = 1, top: number = PLACE_INSET): CardLayout {
  const cols = Math.max(1, Math.ceil(Math.sqrt(total)));
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: snap(PLACE_INSET + col * (DEFAULT_W + DEFAULT_GAP)),
    y: snap(top + row * (DEFAULT_H + DEFAULT_GAP)),
    w: DEFAULT_W,
    h: DEFAULT_H,
    z: index + 1,
  };
}
