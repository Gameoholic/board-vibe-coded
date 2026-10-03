import { formatPercent } from "@board/contracts";
import { BoostIcon, CrystalIcon, SnowflakeIcon, TargetIcon } from "./Icons";
import type { AppliedModifier, ModifierId, Settings, Task } from "./types";
import { frostFill } from "./types";

// How each modifier looks (what it does is the contract's — modifiers.ts): its tag beside the task's name,
// its colour, and its line under the task. One entry per modifier, keyed by its id, so a new modifier is one
// entry here and the row, the bracket and the menus pick it up — none of them knows a modifier by name.

type IconComponent = (props: { size?: number }) => React.ReactElement;

// Where a row is, for the looks that depend on it.
export interface RowPlace {
  // Whether the task is in a Freezer — where everything's frozen.
  onIce: boolean;
}

export interface ModifierLook {
  tag: string;
  color: string;
  icon: IconComponent;
  // Its line under the task: what it does to the task's own `points`.
  line: (m: AppliedModifier, points: number) => string;
  // Whether its tag shows on ice (frost's would say nothing in the Freezer; a Bounty's still does).
  tagOnIce: boolean;
  // How full it is (0 to 1), shown as a bar on its line while the task is on ice.
  fill?: (task: Task, settings: Settings) => number;
  // Its always-on look on the row (an `aura-…` class in App.css), like a game's enchanted glint.
  aura?: (task: Task, settings: Settings, place: RowPlace) => string | undefined;
  // A plain tag: it stays still, with no glow, even while its aura is on.
  plainTag?: boolean;
}

export const MODIFIER_LOOKS: Record<ModifierId, ModifierLook> = {
  bounty: {
    tag: "Bounty",
    color: "var(--mod-bounty)",
    icon: TargetIcon,
    line: (m) => `×${m.value} bounty`,
    tagOnIce: true,
    aura: () => "bounty",
  },
  frost: {
    tag: "Frosted",
    color: "var(--mod-frost)",
    icon: SnowflakeIcon,
    line: (m, points) => `+${formatPercent(Math.round(points * m.value))} frost`,
    tagOnIce: false,
    fill: frostFill,
    // Full frost on ice is Subzero waiting to be thawed.
    aura: (task, settings, place) => (place.onIce && frostFill(task, settings) >= 1 ? "subzero" : undefined),
  },
  subzero: {
    tag: "Subzero",
    color: "var(--mod-subzero)",
    icon: CrystalIcon,
    line: (m) => `=${formatPercent(m.value)} subzero`,
    tagOnIce: true,
    aura: () => "subzero",
  },
  booster: {
    tag: "Boosted",
    color: "var(--mod-booster)",
    icon: BoostIcon,
    line: (m) => `+${formatPercent(m.value)} boost`,
    tagOnIce: true,
    aura: () => "boost",
    plainTag: true,
  },
};

/** A modifier's look — none for one this build doesn't know (an id from a newer or retired modifier). */
export const lookOf = (m: AppliedModifier): ModifierLook | undefined => MODIFIER_LOOKS[m.id as ModifierId];

/** A bracket's ink from its modifiers: the one's colour, or a blend across several, in their order. */
export function modifierInk(modifiers: readonly AppliedModifier[]): string | undefined {
  const colors = modifiers.flatMap((m) => lookOf(m)?.color ?? []);
  if (colors.length === 0) return undefined;
  return `linear-gradient(90deg, ${(colors.length === 1 ? [colors[0], colors[0]] : colors).join(", ")})`;
}
