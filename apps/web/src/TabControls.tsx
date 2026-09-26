import { AnimatePresence, motion } from "framer-motion";
import { useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, EyeIcon, PinIcon, SortIcon } from "./Icons";
import Popover from "./Popover";
import { useClickOutside } from "./useClickOutside";
import { DEFAULT_TAB_PREFS, type TabPrefs } from "./useLocalConfig";

// A tab's view controls — the Sort and Display header buttons — shared by every tab kind. Each kind
// declares its own options (what its items can be sorted by, which row extras can be shown); the
// menus, the pinning, and how the choice persists per tab are written once here.

type IconComponent = (props: { size?: number }) => React.ReactElement;

export interface SortOption {
  mode: string;
  label: string;
  icon: IconComponent;
}

export interface DisplayOption {
  key: string;
  label: string;
  icon: IconComponent;
  defaultOn?: boolean; // shown until the owner turns it off (absent ≡ off by default)
}

// A tab's current view read from its persisted prefs (undefined until first touched) with the tab
// kind's display defaults applied, plus setters that write back through `onChange`.
export function tabView(prefs: TabPrefs | undefined, onChange: (patch: Partial<TabPrefs>) => void, displayOptions: DisplayOption[]) {
  const p = prefs ?? DEFAULT_TAB_PREFS;
  const shown = (key: string) => p.display[key] ?? displayOptions.find((o) => o.key === key)?.defaultOn ?? false;
  return {
    sortMode: p.sortMode,
    setSortMode: (mode: string) => onChange({ sortMode: mode }),
    shown,
    setShown: (key: string, on: boolean) => onChange({ display: { ...p.display, [key]: on } }),
  };
}

interface SortMenuProps {
  options: SortOption[];
  mode: string;
  onSelect: (mode: string) => void;
  // With pinning, only the pinned sorts (plus the active one, so it's never hidden) show up front and
  // the rest sit under "Show more"; without it (a short list), every option shows.
  pinned?: { modes: string[]; onToggle: (mode: string) => void };
}

export function SortMenu({ options, mode, onSelect, pinned }: SortMenuProps) {
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  const topModes = new Set([...(pinned?.modes ?? []), mode]);
  const topSorts = pinned ? options.filter((o) => topModes.has(o.mode)) : options;
  const moreSorts = pinned ? options.filter((o) => !topModes.has(o.mode)) : [];

  const renderOption = (opt: SortOption) => (
    <div key={opt.mode} className={`sort-row${mode === opt.mode ? " active" : ""}`}>
      <button
        type="button"
        className="sort-option"
        onClick={() => {
          onSelect(opt.mode);
          setOpen(false);
        }}
      >
        <span className="sort-option-left">
          <opt.icon />
          {opt.label}
        </span>
        {mode === opt.mode && <CheckIcon />}
      </button>
      {pinned && (
        <button
          type="button"
          className={`pin-btn${pinned.modes.includes(opt.mode) ? " pinned" : ""}`}
          aria-label={pinned.modes.includes(opt.mode) ? `Unpin ${opt.label}` : `Pin ${opt.label}`}
          aria-pressed={pinned.modes.includes(opt.mode)}
          onClick={() => pinned.onToggle(opt.mode)}
        >
          <PinIcon filled={pinned.modes.includes(opt.mode)} />
        </button>
      )}
    </div>
  );

  return (
    <div className="popover-anchor" ref={ref}>
      <button type="button" className="sort-btn" aria-label="Sort" onClick={() => setOpen((v) => !v)}>
        <SortIcon />
      </button>
      <Popover title="Sort" open={open} onClose={() => setOpen(false)} align="right" width={212}>
        <div className="sort-menu">
          {topSorts.map(renderOption)}
          {moreSorts.length > 0 && (
            <>
              <button
                type="button"
                className={`sort-more-btn${moreOpen ? " open" : ""}`}
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((v) => !v)}
              >
                <span>{moreOpen ? "Show less" : "Show more"}</span>
                <ChevronDownIcon />
              </button>
              <AnimatePresence initial={false}>
                {moreOpen && (
                  <motion.div
                    className="sort-more"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                  >
                    {moreSorts.map(renderOption)}
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </div>
      </Popover>
    </div>
  );
}

interface DisplayMenuProps {
  options: DisplayOption[];
  shown: (key: string) => boolean;
  onToggle: (key: string, on: boolean) => void;
}

export function DisplayMenu({ options, shown, onToggle }: DisplayMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  return (
    <div className="popover-anchor" ref={ref}>
      <button type="button" className="sort-btn" aria-label="Display options" onClick={() => setOpen((v) => !v)}>
        <EyeIcon />
      </button>
      <Popover title="Display" open={open} onClose={() => setOpen(false)} align="right" width={190}>
        <div className="display-menu">
          {options.map((opt) => (
            <label key={opt.key} className="display-option">
              <input type="checkbox" checked={shown(opt.key)} onChange={(e) => onToggle(opt.key, e.target.checked)} />
              <opt.icon />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </Popover>
    </div>
  );
}
