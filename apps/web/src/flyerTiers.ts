// How loudly a scored task celebrates, as a function of what it was worth. Ticking "reset board"
// (0.2%) and finishing a 3-hour practice block (5%) used to look identical, which flattened the
// one thing this app has over the whiteboard it replaced: the feedback actually feeling earned.
//
// Every threshold and every magnitude lives in this table on purpose — retuning the feel should
// never mean reading the animation code. FlyingPoints and PointsCounter hold no numbers of their
// own; they read the tier they were handed.

export type FlyerTierId = "spark" | "charge" | "surge" | "overdrive";

export interface FlyerTier {
  id: FlyerTierId;
  /** Lowest award (integer thousandths-of-a-percent) that lands in this tier: 1% === 1000. */
  minPoints: number;
  /** The anticipation beat: the bracket rattles in place before it launches. */
  windup: {
    /** 0 = no wind-up at all; the flyer launches on the frame it spawns. */
    duration: number;
    /** Peak px of the side-to-side rattle. */
    shake: number;
    /** Scale it has swollen to by the moment of launch. */
    swell: number;
    /** Expanding rings pulsing out of the bracket while it charges. */
    rings: number;
    /** Particles pulled *inward* to the bracket — the landing burst, reversed. */
    intake: number;
    /** drop-shadow blur in px at full charge. */
    glow: number;
  };
  flight: {
    duration: number;
    /** Peak scale just after it detaches from the row. */
    pop: number;
    /** 0 = flies straight in. 0.08 = overshoots the counter by 8%, then snaps back. */
    overshoot: number;
    /** Trailing afterimages of the bracket. */
    ghosts: number;
  };
  landing: {
    particles: number;
    /** Base px a particle travels; each adds up to `jitter` more at random. */
    distance: number;
    jitter: number;
    /** Peak scale of the counter's value text. */
    pulse: number;
    shockwaves: number;
    /** Peak px of the counter box's own recoil. */
    shake: number;
    /** Whether the 4 corner brackets flare outward. */
    flare: boolean;
  };
}

// Ascending by minPoints; the first entry must be 0 so every amount matches something. Typed as a
// non-empty tuple so that guarantee is the compiler's problem rather than a comment.
export const FLYER_TIERS: [FlyerTier, ...FlyerTier[]] = [
  {
    id: "spark",
    minPoints: 0,
    // No wind-up: a 0.2% tick should stay instant. These flight/landing numbers are the ones the
    // animation shipped with before it was tiered, so sub-1% is untouched by construction.
    windup: { duration: 0, shake: 0, swell: 1, rings: 0, intake: 0, glow: 0 },
    flight: { duration: 1, pop: 1.14, overshoot: 0, ghosts: 0 },
    landing: {
      particles: 10,
      distance: 36,
      jitter: 26,
      pulse: 1.22,
      shockwaves: 0,
      shake: 0,
      flare: false,
    },
  },
  {
    id: "charge",
    minPoints: 1000,
    windup: { duration: 0.42, shake: 2, swell: 1.1, rings: 0, intake: 0, glow: 0 },
    flight: { duration: 0.95, pop: 1.45, overshoot: 0, ghosts: 0 },
    landing: {
      particles: 16,
      distance: 44,
      jitter: 30,
      pulse: 1.35,
      shockwaves: 0,
      shake: 0,
      flare: false,
    },
  },
  {
    id: "surge",
    minPoints: 3000,
    windup: { duration: 0.7, shake: 4, swell: 1.24, rings: 2, intake: 0, glow: 7 },
    flight: { duration: 1.05, pop: 1.75, overshoot: 0, ghosts: 3 },
    landing: {
      particles: 24,
      distance: 56,
      jitter: 34,
      pulse: 1.5,
      shockwaves: 1,
      shake: 0,
      flare: false,
    },
  },
  {
    id: "overdrive",
    minPoints: 10000,
    windup: { duration: 1, shake: 7, swell: 1.5, rings: 3, intake: 8, glow: 14 },
    flight: { duration: 1.15, pop: 2.1, overshoot: 0.08, ghosts: 5 },
    landing: {
      particles: 34,
      distance: 70,
      jitter: 40,
      pulse: 1.7,
      shockwaves: 2,
      shake: 6,
      flare: true,
    },
  },
];

// Finishing a broken-down task (its last piece) celebrates the whole task, not just the piece: one tier
// above what the piece alone earns, and never less than this.
const FINALE_FLOOR: FlyerTierId = "surge";

export function tierFor(amount: number, finale = false): FlyerTier {
  // The heavy tiers — shaking, swelling, a trailing smear of afterimages — are precisely what this
  // setting exists to switch off, so they collapse to the plain one rather than merely slowing down.
  // Same check as useDiegeticDepth's.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return FLYER_TIERS[0];

  let match = 0;
  FLYER_TIERS.forEach((tier, i) => {
    if (amount >= tier.minPoints) match = i;
  });
  if (finale) {
    const floor = FLYER_TIERS.findIndex((tier) => tier.id === FINALE_FLOOR);
    match = Math.min(Math.max(match + 1, floor), FLYER_TIERS.length - 1);
  }
  return FLYER_TIERS[match];
}
