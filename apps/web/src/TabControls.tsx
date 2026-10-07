import { AnimatePresence, motion } from "framer-motion";
import { useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, EyeIcon, PinIcon, SortIcon } from "./Icons";
import Popover from "./Popover";
import { useClickOutside } from "./useClickOutside";
import { DEFAULT_TAB_PREFS, type TabPrefs } from "./useLocalConfig";

// A tab's view controls — the Sort and Display header buttons — shared by every tab kind. Each tab says what
// it offers (tabViews.ts): which sorts and display toggles, under which words, and which sit up front
// (pinned) with the rest under "Show more". The menus, the pinning and how the choices persist per tab are
// written once here; how a sort orders items is its option's own.

type IconComponent = (props: { size?: number }) => React.ReactElement;

/** One choice in a tab's Sort or Display menu. */
export interface MenuOption {
  key: string;
  label: string;
  icon: IconComponent;
  // Up front in its menu, or under "Show more" — the tab's call, which the owner can change per tab.
  pinned?: boolean;
}

/** One headed part of a list a sort has split up. Without a `label` it has no header (there's nothing to
 *  set it apart from). */
export interface ListPart<T> {
  key: string;
  label?: string;
  color?: string; // a theme token for its header's words
  items: T[];
}

/** A sort, and how it orders a list's items given what it needs to know (`C`). Without `compare` it keeps
 *  the list's own order (Manual) — and so do a sort's `parts`: instead of ordering item against item, a sort
 *  can split a list into headed parts, each in the list's own order, so its rows still drag within their part. */
export interface SortOption<T, C> extends MenuOption {
  compare?: (ctx: C) => (a: T, b: T) => number;
  parts?: (ctx: C) => (items: readonly T[]) => ListPart<T>[];
}

/** An optional extra on a tab's rows. */
export interface DisplayOption extends MenuOption {
  defaultOn?: boolean; // shown until the owner turns it off (absent ≡ off by default)
}

/** What a tab's two menus offer, in the order they list them. */
export interface TabOffer<T, C> {
  sorts: SortOption<T, C>[];
  displays: DisplayOption[];
}

/** A kind's catalog: every option its tabs can offer, by name, each typed as an option of its menu (so a
 *  tab can offer one with fields the entry itself leaves out, like `defaultOn`). Used as
 *  `catalog<DisplayOption>()({ … })` — the first call names the option type, the second takes the entries. */
export const catalog =
  <O extends MenuOption>() =>
  <K extends string>(entries: Record<K, O>): Record<K, O> =>
    entries;

/** A catalog option as one tab offers it: up front or not, and in its own words where the catalog's don't
 *  fit ("Days frozen" for the Freezer's Age). The logic stays the catalog's. */
export function offer<O extends MenuOption>(option: O, how: Partial<O> = {}): O {
  return { ...option, ...how };
}

/** `items` in `sort`'s order — as they are for a sort without its own (Manual). */
export function sortItems<T, C>(items: readonly T[], sort: SortOption<T, C> | undefined, ctx: C): T[] {
  return sort?.compare ? [...items].sort(sort.compare(ctx)) : [...items];
}

type Menu = "sort" | "display";

// A tab's current view: its persisted prefs (undefined until first touched) read against what the tab
// offers — a sort it doesn't offer (any more) falls back to its first, a display it doesn't offer is off —
// plus setters that write back through `onChange`. Pins are per tab, over each option's own default.
export function tabView(
  prefs: TabPrefs | undefined,
  onChange: (patch: Partial<TabPrefs>) => void,
  offered: { sorts: readonly MenuOption[]; displays: readonly DisplayOption[] },
) {
  const p = prefs ?? DEFAULT_TAB_PREFS;
  const sortMode = offered.sorts.some((o) => o.key === p.sortMode) ? p.sortMode : (offered.sorts[0]?.key ?? DEFAULT_TAB_PREFS.sortMode);
  const shown = (key: string) => {
    const option = offered.displays.find((o) => o.key === key);
    return !!option && (p.display[key] ?? option.defaultOn ?? false);
  };
  const isPinned = (menu: Menu, option: MenuOption) => p.pinned?.[`${menu}:${option.key}`] ?? !!option.pinned;
  return {
    sortMode,
    setSortMode: (mode: string) => onChange({ sortMode: mode }),
    shown,
    setShown: (key: string, on: boolean) => onChange({ display: { ...p.display, [key]: on } }),
    isPinned,
    togglePin: (menu: Menu, option: MenuOption) =>
      onChange({ pinned: { ...p.pinned, [`${menu}:${option.key}`]: !isPinned(menu, option) } }),
  };
}

export type TabView = ReturnType<typeof tabView>;

// The rows both menus share: the pinned ones up front — and those in use (`inUse`), so what's on is never
// tucked away — the rest under "Show more", each row with its pin.
function PinnedRows<O extends MenuOption>({
  menu,
  options,
  view,
  inUse,
  renderOption,
}: {
  menu: Menu;
  options: readonly O[];
  view: TabView;
  inUse: (option: O) => boolean;
  renderOption: (option: O) => React.ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const top = options.filter((o) => view.isPinned(menu, o) || inUse(o));
  const more = options.filter((o) => !top.includes(o));

  const row = (o: O) => {
    const pinned = view.isPinned(menu, o);
    return (
      <div key={o.key} className="view-row">
        {renderOption(o)}
        <button
          type="button"
          className={`pin-btn${pinned ? " pinned" : ""}`}
          aria-label={pinned ? `Unpin ${o.label}` : `Pin ${o.label}`}
          aria-pressed={pinned}
          onClick={() => view.togglePin(menu, o)}
        >
          <PinIcon filled={pinned} />
        </button>
      </div>
    );
  };

  return (
    <div className="view-menu">
      {top.map(row)}
      {more.length > 0 && (
        <>
          <button
            type="button"
            className={`view-more-btn${moreOpen ? " open" : ""}`}
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
          >
            <span>{moreOpen ? "Show less" : "Show more"}</span>
            <ChevronDownIcon />
          </button>
          <AnimatePresence initial={false}>
            {moreOpen && (
              <motion.div
                className="view-more"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
              >
                {more.map(row)}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

export function SortMenu({ options, view }: { options: readonly MenuOption[]; view: TabView }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  return (
    <div className="popover-anchor" ref={ref}>
      <button type="button" className="sort-btn" aria-label="Sort" onClick={() => setOpen((v) => !v)}>
        <SortIcon />
      </button>
      <Popover title="Sort" open={open} onClose={() => setOpen(false)} align="right" width={212} fit>
        <PinnedRows
          menu="sort"
          options={options}
          view={view}
          inUse={(o) => o.key === view.sortMode}
          renderOption={(o) => (
            <button
              type="button"
              className="sort-option"
              onClick={() => {
                view.setSortMode(o.key);
                setOpen(false);
              }}
            >
              <span className="sort-option-left">
                <o.icon />
                {o.label}
              </span>
              {o.key === view.sortMode && <CheckIcon />}
            </button>
          )}
        />
      </Popover>
    </div>
  );
}

export function DisplayMenu({ options, view }: { options: readonly DisplayOption[]; view: TabView }) {
  const [open, setOpen] = useState(false);
  // What was on as the menu opened stays up front while it's open — ticking one under "Show more" doesn't
  // make it jump out from under the pointer.
  const [onAtOpen, setOnAtOpen] = useState<ReadonlySet<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  return (
    <div className="popover-anchor" ref={ref}>
      <button
        type="button"
        className="sort-btn"
        aria-label="Display options"
        onClick={() => {
          setOnAtOpen(new Set(options.filter((o) => view.shown(o.key)).map((o) => o.key)));
          setOpen((v) => !v);
        }}
      >
        <EyeIcon />
      </button>
      <Popover title="Display" open={open} onClose={() => setOpen(false)} align="right" width={212}>
        <PinnedRows
          menu="display"
          options={options}
          view={view}
          inUse={(o) => onAtOpen.has(o.key)}
          renderOption={(o) => (
            <label className="display-option">
              <input type="checkbox" checked={view.shown(o.key)} onChange={(e) => view.setShown(o.key, e.target.checked)} />
              <o.icon />
              <span>{o.label}</span>
            </label>
          )}
        />
      </Popover>
    </div>
  );
}
