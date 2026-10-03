import type { ReactNode } from "react";
import type { ModifierLook } from "./modifierLooks";

// How a modifier shows on a row — the same on a task and on a reward (CONVENTIONS.md → "Modifiers"): a tag
// beside the name and a line under it, each in the modifier's own colour. What they say is its look's.

/** A modifier's tag beside a name. `glow` pulses it, while its aura is on. */
export function ModifierTag({ look, glow = false }: { look: ModifierLook; glow?: boolean }) {
  return (
    <span className={`modifier-tag${glow ? " glow" : ""}`} style={{ "--c": look.color } as React.CSSProperties}>
      {look.tag}
    </span>
  );
}

/** A modifier's line under a name: its icon and what it does. `children` trail it (frost's bar on ice). */
export function ModifierLine({ look, text, children }: { look: ModifierLook; text: string; children?: ReactNode }) {
  return (
    <span className="modifier-line" style={{ "--c": look.color } as React.CSSProperties}>
      <look.icon size={12} />
      <span>{text}</span>
      {children}
    </span>
  );
}
