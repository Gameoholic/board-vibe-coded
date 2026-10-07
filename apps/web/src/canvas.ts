import type { CardLayout } from "./useLocalConfig";

// The whole free-canvas coordinate system in one place so the card, the camera and the
// default-placement math can't drift apart.

export const GRID = 20; // snap step, in world px — everything lands on this lattice
export const MARGIN = 220; // slack around the cards you can pan/drop into, in world px
export const MIN_W = 240;
// Just the header: its 26px, its 14px gap and the card's 20px padding above and below — a tab can fold to its title.
export const MIN_H = 80;

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

// The room the points counter takes at a canvas's top-centre while it's docked there (App.css's .hud-dock:
// its inset, the plate's height, and air under it) — the arranged block starts below it.
export const DOCK_CLEARANCE = 128;

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

const overlaps = (a: CardLayout, b: CardLayout) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Where each card sits: its saved layout, or — never moved yet — the tidy default for its place in order.
// On a board that's been arranged, a card that's new to it (a tab added since, like a Freezer) takes the first
// slot of that tidy grid no card covers, on top, so it shows up beside the others rather than under one.
export function placeCards(cards: { id: string }[], layouts: Record<string, CardLayout>, top?: number): Record<string, CardLayout> {
  const map: Record<string, CardLayout> = {};
  const taken = cards.flatMap((c) => layouts[c.id] ?? []);
  let z = taken.reduce((max, l) => Math.max(max, l.z), 0);
  let slot = 0;
  cards.forEach((c, i) => {
    const saved = layouts[c.id];
    if (saved || taken.length === 0) {
      map[c.id] = saved ?? defaultLayout(i, cards.length, top);
      return;
    }
    let place = defaultLayout(slot++, cards.length, top);
    while (taken.some((t) => overlaps(t, place))) place = defaultLayout(slot++, cards.length, top);
    taken.push(place);
    map[c.id] = { ...place, z: ++z };
  });
  return map;
}
