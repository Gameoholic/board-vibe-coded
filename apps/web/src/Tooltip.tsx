import type { ReactNode } from "react";

// A small hover/focus tooltip in the app's dark-bubble style (the same look as the tier-dot label
// bubble). CSS-driven — no JS state — so it's cheap and reveals on focus too, which is how it works
// on touch. Wrap the trigger element; pass the text as `label` — a line of text, or several (block-level
// children each take their own line). `position` picks the side the bubble opens on (default above), and `align`
// whether it's centred on the trigger or starts at its left edge (for a trigger at the left of a card, where a
// centred bubble would hang off it). The wrapper is focusable so the bubble still shows for a locked/disabled
// child (which wouldn't take focus).
interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
  position?: "top" | "bottom";
  align?: "center" | "start";
  className?: string;
}

export default function Tooltip({ label, children, position = "top", align = "center", className }: TooltipProps) {
  return (
    <span className={`tooltip-wrap${className ? ` ${className}` : ""}`} tabIndex={0}>
      {children}
      <span className={`tooltip-bubble tooltip-${position}${align === "start" ? " tooltip-start" : ""}`} role="tooltip">
        {label}
      </span>
    </span>
  );
}
