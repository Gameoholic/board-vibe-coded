import type { CSSProperties, ReactNode } from "react";

// The app's tooltip: a small dark bubble shown on hover and on keyboard focus. It's the one way to hint at
// anything — never the browser's own (`title="…"` draws Chrome's grey box, which doesn't belong on the board).
// CSS-driven, no JS state. Wrap the trigger and pass the words as `label`: a line of text, or several (block-level
// children each take their own line). With no label it's just its children, so a hint that only sometimes
// applies needs no branch around it.
interface TooltipProps {
  label?: ReactNode;
  children: ReactNode;
  // The side the bubble opens on (default above).
  position?: "top" | "bottom" | "left" | "right";
  // Above or below the trigger: centred on it, or lined up with its left (`start`) or right (`end`) edge — for a
  // trigger at a card's edge, where a centred bubble would hang off it.
  align?: "center" | "start" | "end";
  // The bubble shows while anything inside has focus. This lets the wrapper itself take it, for a child that
  // can't (plain text, a disabled box) — which is also how a tap reaches it on a touch screen. A child that
  // takes focus (a button) needs nothing, and would only gain a second tab stop.
  focusable?: boolean;
  // Keeps the wrapper in the run of text, for a trigger that must still wrap with it (the points bracket).
  inline?: boolean;
  // For running text (a task's description): the bubble wraps at a set width, keeping the text's own line
  // breaks, instead of staying on one line.
  wrap?: boolean;
  // The trigger's own look, where the wrapper stands in for an element with a place in a layout (a grid cell,
  // a row) — the wrapper then is that element.
  className?: string;
  style?: CSSProperties;
}

export default function Tooltip({ label, children, position = "top", align = "center", focusable = false, inline = false, wrap = false, className, style }: TooltipProps) {
  const shown = label != null && label !== false && label !== "";
  return (
    <span className={`tooltip-wrap${inline ? " tooltip-inline" : ""}${className ? ` ${className}` : ""}`} style={style} tabIndex={focusable ? 0 : undefined}>
      {children}
      {shown && (
        <span className={`tooltip-bubble tooltip-${position}${align === "center" ? "" : ` tooltip-${align}`}${wrap ? " tooltip-wrapping" : ""}`} role="tooltip">
          {label}
        </span>
      )}
    </span>
  );
}
