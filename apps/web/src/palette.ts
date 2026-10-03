export const PALETTE = [
  "#6366f1",
  "#0ea5e9",
  "#f59e0b",
  "#64748b",
  "#10b981",
  "#ec4899",
  "#a855f7",
  "#ef4444",
];

// A tab's colour as it's drawn on the current theme. A dark theme lifts a colour too dark to read on it (an
// ink-black tab) to a readable lightness, keeping its hue; on the light theme the colour stays exactly as
// picked. How far to lift is theme.css's --ink-floor, so this needs no idea which theme is on. A browser
// without relative colours gets the colour as picked.
const LIFTS = typeof CSS !== "undefined" && CSS.supports("color", "oklch(from red max(l, 0.5) c h)");
export const tabInk = (color: string) => (LIFTS ? `oklch(from ${color} max(l, var(--ink-floor)) c h)` : color);
