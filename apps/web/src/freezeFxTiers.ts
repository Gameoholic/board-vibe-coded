// Every magnitude the freeze effects use (freezeFx.ts) — the one home, like flyerTiers.ts for the flyer:
// retune the feel here, never in the animation code. They scale with how full a task's frost is (0 to 1):
// a little frost cracks, half the cap shatters, full frost (Subzero) brings the avalanche.

export type FrostTier = "none" | "crack" | "shatter" | "avalanche";

export function frostTierFor(fill: number): FrostTier {
  return fill >= 1 ? "avalanche" : fill >= 0.5 ? "shatter" : fill > 0 ? "crack" : "none";
}

// Ice: bright, deep, white and pale blue shards; Subzero adds its indigo. A Bounty's embers are red and amber.
export const SHARD_COLORS = ["#38bdf8", "#0284c7", "#ffffff", "#bae6fd"];
export const SUBZERO_COLOR = "#4f46e5";
export const EMBER_COLORS = ["#dc2626", "#f59e0b", "#fca5a5"];

// Thawing lets the frost out of the task's bracket: shards (how many, how far, px) and how hard it pulses.
// Full frost first shivers (`shiverMs`), then shatters, slams "Subzero" on, and counts its bracket up
// (`countMs`) to what it now pays, while its tab flashes.
export const THAW_FX: Record<FrostTier, { shards: number; spread: number; pulse: number }> = {
  none: { shards: 0, spread: 0, pulse: 1 },
  crack: { shards: 10, spread: 50, pulse: 1.18 },
  shatter: { shards: 20, spread: 90, pulse: 1.32 },
  avalanche: { shards: 44, spread: 190, pulse: 1.6 },
};
export const THAW_SUBZERO = { shiverMs: 380, countMs: 1100, flashMs: 1300 };

// Finishing a frosted task. Crack: a ring off its checkbox and a few shards. Shatter: a sheet of ice sweeps
// over the row (`coverMs`), cracks spread from its bracket, and it breaks into falling shards (`gravity` px
// of fall) with rings. Avalanche: the screen's edges frost over (`vignetteMs`), the row freezes in place
// (`holdMs`), then explodes — rings, shards, snow across the screen (`snow` flakes for `snowMs`) — and
// "Subzero" slams in the middle with what it paid.
export const FINISH_FX = {
  crack: { ring: 46, shards: 12, spread: 60 },
  shatter: { coverMs: 700, breakAt: 400, shards: 30, spread: 150, gravity: 150, rings: [90, 60] },
  avalanche: {
    vignetteMs: 2800,
    holdMs: 420,
    coverMs: 900,
    shards: 64,
    spread: 300,
    gravity: 240,
    rings: [110, 170, 230],
    snow: 44,
    snowMs: 2800,
    slamMs: 1900,
  },
};

// Winning a Bounty throws embers up off its bracket, with a red ring.
export const BOUNTY_FX = { ring: 60, embers: 18, spread: 70, rise: 80 };
