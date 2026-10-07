import { BagIcon, BoardIcon, GearIcon } from "./Icons";
import ThemeSwitch from "./ThemeSwitch";
import Tooltip from "./Tooltip";

// The app's "places" — the board is home, settings is its own place. "shop" isn't a separate place but
// a mode of the board's (App: the tabs poof away and the shop appears on the same canvas); it gets a
// rail button of its own so it's one tap away. A device-local preview of BACKLOG.md → "Shop / wallet".
export type AppView = "board" | "shop" | "settings";

interface NavEntry {
  view: AppView | null; // null = not navigable yet (disabled placeholder)
  label: string;
  icon: React.ReactNode;
}

const ENTRIES: NavEntry[] = [
  { view: "board", label: "Board", icon: <BoardIcon size={18} /> },
  { view: "shop", label: "Shop", icon: <BagIcon size={18} /> },
  { view: "settings", label: "Settings", icon: <GearIcon size={18} /> },
];

interface AppNavProps {
  view: AppView;
  onChange: (view: AppView) => void;
}

// A slim fixed rail, pinned to the left edge. Icon-only with a tooltip, like the canvas toolbar's
// bare-button pattern — one button per place, the active one highlighted.
function AppNav({ view, onChange }: AppNavProps) {
  return (
    <nav className="app-nav" aria-label="Views">
      {ENTRIES.map((entry) => {
        const active = entry.view === view;
        const disabled = entry.view === null;
        return (
          <Tooltip key={entry.label} label={entry.label} position="right">
            <button
              type="button"
              className={`nav-btn${active ? " active" : ""}${disabled ? " disabled" : ""}`}
              aria-label={entry.label}
              aria-current={active ? "page" : undefined}
              disabled={disabled}
              onClick={() => entry.view && onChange(entry.view)}
            >
              {entry.icon}
            </button>
          </Tooltip>
        );
      })}
      <ThemeSwitch />
    </nav>
  );
}

export default AppNav;
