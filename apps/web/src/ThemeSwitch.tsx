import { useRef, useState } from "react";
import ActionMenu from "./ActionMenu";
import type { MenuPoint, RowAction } from "./ActionMenu";
import { ChevronDownIcon, MonitorIcon, MoonIcon, SunIcon } from "./Icons";
import { THEMES, useTheme } from "./useTheme";
import type { ThemeId } from "./useTheme";

// A theme's swatch in the menu: drawn with that theme's own tokens (the data-theme attribute scopes them,
// see theme.css), so the swatch can't drift from the theme it shows.
function swatchIcon(id: ThemeId): RowAction["icon"] {
  return function ThemeSwatch() {
    return <span className="theme-swatch" data-theme={id} aria-hidden="true" />;
  };
}
const SWATCHES = Object.fromEntries(THEMES.map((t) => [t.id, swatchIcon(t.id)])) as Record<ThemeId, RowAction["icon"]>;

// The bottom of the rail: one button flips between light and dark, and the chevron under it opens every
// theme (and Match system) in the shared actions menu.
export default function ThemeSwitch() {
  const { choice, dark, choose, toggle } = useTheme();
  const [menuAt, setMenuAt] = useState<MenuPoint | null>(null);
  // A press on the chevron while the menu is open closes it (the menu closes on any outside press) — this
  // keeps the click that follows from opening it straight back up.
  const pressedWhileOpen = useRef(false);

  const option = (t: (typeof THEMES)[number], set: string): RowAction => ({
    key: t.id,
    label: t.label,
    icon: SWATCHES[t.id],
    checked: choice === t.id,
    set,
    onSelect: () => choose(t.id),
  });
  const groups: RowAction[][] = [
    [
      { key: "system", label: "Match system", icon: MonitorIcon, checked: choice === "system", set: "Theme", onSelect: () => choose("system") },
      ...THEMES.filter((t) => !t.editor).map((t) => option(t, "Theme")),
    ],
    THEMES.filter((t) => t.editor).map((t) => option(t, "Editor themes")),
  ];

  return (
    <div className="nav-theme">
      <button
        type="button"
        className="nav-btn"
        title={dark ? "Light mode" : "Dark mode"}
        aria-label={dark ? "Light mode" : "Dark mode"}
        onClick={toggle}
      >
        {dark ? <SunIcon size={18} /> : <MoonIcon size={18} />}
      </button>
      <button
        type="button"
        className={`nav-btn nav-more${menuAt ? " active" : ""}`}
        title="Themes"
        aria-label="Themes"
        aria-haspopup="menu"
        aria-expanded={menuAt !== null}
        onPointerDown={() => {
          pressedWhileOpen.current = menuAt !== null;
        }}
        onClick={(e) => {
          if (pressedWhileOpen.current) {
            pressedWhileOpen.current = false;
            return;
          }
          // Beside the rail, its bottom edge level with the chevron's (the menu flips up near the screen's foot).
          const rect = e.currentTarget.getBoundingClientRect();
          setMenuAt({ x: rect.right + 10, y: rect.bottom });
        }}
      >
        <ChevronDownIcon size={14} />
      </button>
      <ActionMenu at={menuAt} groups={groups} onClose={() => setMenuAt(null)} />
    </div>
  );
}
