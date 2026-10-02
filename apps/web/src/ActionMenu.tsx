import { AnimatePresence, motion } from "framer-motion";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "./Icons";

// The actions menu a list row opens on right-click or long-press (ItemRow wires those gestures). A row
// declares what it can do as groups of actions, with separators between the groups; the menu does the
// rest — opening at the pointer, staying on screen, keyboard use, closing. It's portaled to <body> in
// screen space, so the canvas zoom doesn't shrink it and a card's clipping and stacking can't hide it.

type IconComponent = (props: { size?: number }) => React.ReactElement;

export interface RowAction {
  key: string;
  label: string;
  icon: IconComponent;
  // The KeyboardEvent.key that picks this action while the menu is open ("e", "Delete"), also shown at
  // the item's right edge.
  shortcut?: string;
  danger?: boolean;
  // A cost worth knowing before picking it, shown under the label ("Breaks “Morning routine”").
  warning?: string;
  // What it gains, shown under the label the same way ("Start now for +0.5%").
  note?: string;
  // Shown but not pickable — `warning` then says why ("A Bounty can't be frozen").
  disabled?: boolean;
  // One of a set of choices (a task's Status): ticked when it's the current one, in place of a shortcut.
  checked?: boolean;
  // The name of the set it belongs to ("Status"), captioned above the set's first item — so a set reads as
  // one thing without a separator line cutting it off from the actions beside it.
  set?: string;
  onSelect: () => void;
}

export interface MenuPoint {
  x: number;
  y: number;
}

// How close (px) the menu may come to the window's edges before it flips to the other side of the pointer.
const EDGE = 8;

const shortcutLabel = (key: string) => (key === "Delete" ? "Del" : key.toUpperCase());

// Every item the keyboard moves through — plain actions and ticked choices alike.
const MENU_ITEMS = '[role="menuitem"], [role="menuitemradio"]';

interface ActionMenuProps {
  at: MenuPoint | null; // where it opened; null ≡ closed
  groups: RowAction[][];
  onClose: () => void;
}

export default function ActionMenu({ at, groups, onClose }: ActionMenuProps) {
  return createPortal(
    <AnimatePresence>
      {/* Keyed by the point, so reopening somewhere else starts fresh (focus on the first action). */}
      {at && <MenuPanel key={`${at.x},${at.y}`} at={at} groups={groups.filter((g) => g.length > 0)} onClose={onClose} />}
    </AnimatePresence>,
    document.body,
  );
}

// The menu's own events stop here: through the portal they'd otherwise bubble up the React tree into
// the row and the canvas (a tap on an item would start a touch pan; a right-click would reopen the menu).
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

function MenuPanel({ at, groups, onClose }: { at: MenuPoint; groups: RowAction[][]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);

  // Opens at the pointer, flipped to the pointer's other side where it would spill off screen — measured
  // before paint, so it never shows in the wrong spot. The first action takes focus, so Enter picks it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      x: at.x + w > window.innerWidth - EDGE ? Math.max(EDGE, at.x - w) : at.x,
      y: at.y + h > window.innerHeight - EDGE ? Math.max(EDGE, at.y - h) : at.y,
    });
    el.querySelector<HTMLButtonElement>(MENU_ITEMS)?.focus();
  }, [at]);

  // Anything that moves the world under a screen-space menu, or a press anywhere else, closes it.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("wheel", onClose, { passive: true });
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("wheel", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  function select(action: RowAction) {
    if (action.disabled) return;
    onClose();
    action.onSelect();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    e.stopPropagation();
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>(MENU_ITEMS) ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(i + step + items.length) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose();
    } else {
      const hit = groups.flat().find((a) => !a.disabled && a.shortcut?.toLowerCase() === e.key.toLowerCase());
      if (hit) {
        e.preventDefault();
        select(hit);
      }
    }
  }

  return (
    <motion.div
      ref={ref}
      role="menu"
      className="action-menu"
      style={{
        left: pos.x,
        top: pos.y,
        transformOrigin: `${pos.x < at.x ? "right" : "left"} ${pos.y < at.y ? "bottom" : "top"}`,
      }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      onKeyDown={onKeyDown}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {groups.map((group, gi) => (
        <Fragment key={group[0].key}>
          {gi > 0 && <div className="action-menu-sep" role="separator" />}
          {group.map((action, ai) => (
            <Fragment key={action.key}>
              {action.set && action.set !== group[ai - 1]?.set && (
                <div className="action-menu-caption" aria-hidden="true">
                  {action.set}
                </div>
              )}
              <button
                type="button"
                role={action.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={action.checked}
                aria-disabled={action.disabled || undefined}
                tabIndex={-1}
                className={`action-menu-item${action.danger ? " danger" : ""}${action.disabled ? " disabled" : ""}`}
                // Hover moves focus, so the keyboard and the mouse share one highlight.
                onMouseEnter={(e) => e.currentTarget.focus()}
                onClick={() => select(action)}
              >
                <span className="action-menu-label">
                  <action.icon />
                  <span>
                    {action.label}
                    {action.warning && <span className="action-menu-warning">{action.warning}</span>}
                    {action.note && <span className="action-menu-note">{action.note}</span>}
                  </span>
                </span>
                {action.checked ? (
                  <span className="action-menu-check" aria-hidden="true">
                    <CheckIcon />
                  </span>
                ) : (
                  action.shortcut && !action.disabled && <kbd className="action-menu-key">{shortcutLabel(action.shortcut)}</kbd>
                )}
              </button>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </motion.div>
  );
}
