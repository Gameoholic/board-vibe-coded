import { animate, motion, useMotionValue } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { CheckIcon } from "./Icons";
import Popover from "./Popover";
import Tooltip from "./Tooltip";
import { tabInk } from "./palette";
import { useClickOutside } from "./useClickOutside";

// The one-tab view's switcher, in the frame's corner: the canvas's tabs as a small deck, each a ply in its
// tab's colour filled as far as the tab is done, the tab on screen on top. Pressing it lists the tabs to
// turn to; the deck then cuts to the one picked.

/** What the deck shows of a tab. */
export interface TabFace {
  name: string;
  color: string; // as picked — drawn through tabInk
  count: number; // how much the tab lists
  done?: number; // how much of that is done, in a tab that starts over (a day's, a week's); absent ≡ nothing to finish
}

interface DeckTab extends TabFace {
  id: string;
}

// The plies drawn: a deck of more tabs shows the one it's on and those next in line.
const MAX_PLIES = 6;
// How far apart the plies sit (px, before the pile's tilt), and how far a ply slides clear of the pile on
// its way under it.
const PLY_GAP = 3.5;
const CUT_SLIDE = 26;
const cut = { duration: 0.42, times: [0, 0.35, 0.65, 1], ease: "easeInOut" as const };
const settle = { type: "spring" as const, stiffness: 520, damping: 34 };

const lift = (depth: number, plies: number) => (plies - 1 - depth) * PLY_GAP;
// A tab with nothing to finish is simply its colour.
const fillOf = (tab: TabFace) => (tab.done === undefined ? 1 : tab.count > 0 ? tab.done / tab.count : 0);

function Ply({ tab, depth, plies }: { tab: DeckTab; depth: number; plies: number }) {
  const z = useMotionValue(lift(depth, plies));
  const x = useMotionValue(0);
  const was = useRef(depth);
  useEffect(() => {
    const from = was.current;
    was.current = depth;
    const to = lift(depth, plies);
    if (depth > from) {
      // It was nearer the top: it slides clear, drops and slides back in, rather than sinking through the pile.
      animate(z, [z.get(), z.get(), to, to], cut);
      animate(x, [0, CUT_SLIDE, CUT_SLIDE, 0], cut);
    } else {
      animate(z, to, settle);
    }
  }, [depth, plies, x, z]);
  const look = { "--c": tabInk(tab.color), "--fill": fillOf(tab), "--depth": depth } as React.CSSProperties;
  return <motion.i className="tab-deck-ply" style={{ ...look, x, z }} />;
}

interface TabDeckProps {
  tabs: DeckTab[]; // in the canvas's order
  current: string;
  onPick: (id: string) => void;
}

function TabDeck({ tabs, current, onPick }: TabDeckProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useClickOutside(ref, close, open);

  // The pile from the top down: the tab on screen, then the ones after it, round to the ones before.
  const at = Math.max(0, tabs.findIndex((t) => t.id === current));
  const pile = tabs.map((_, i) => tabs[(at + i) % tabs.length]).slice(0, MAX_PLIES);

  return (
    <div className="popover-anchor tab-deck-anchor" ref={ref}>
      {/* Its list opens where the hint would sit, so the hint steps aside while it's open. */}
      <Tooltip label={open ? undefined : "Switch tab"} position="left">
        <button
          type="button"
          className={`toolbar-btn tab-deck${open ? " open" : ""}`}
          aria-label="Switch tab"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="tab-deck-pile" aria-hidden="true">
            {/* Bottom ply first, so the plies above paint over it wherever the browser flattens the pile. */}
            {[...pile].reverse().map((tab) => (
              <Ply key={tab.id} tab={tab} depth={pile.indexOf(tab)} plies={pile.length} />
            ))}
          </span>
        </button>
      </Tooltip>
      <Popover title="Tabs" open={open} onClose={close} align="right" width={200} fit>
        <div className="view-menu">
          {tabs.map((tab) => (
            <div key={tab.id} className="view-row">
              <button
                type="button"
                className="sort-option tab-pick"
                aria-current={tab.id === current ? "true" : undefined}
                onClick={() => {
                  onPick(tab.id);
                  close();
                }}
              >
                <span className="sort-option-left tab-pick-name" style={{ color: tabInk(tab.color) }}>
                  {tab.name}
                </span>
                <span className="tab-pick-count">{tab.done === undefined ? tab.count : `${tab.done}/${tab.count}`}</span>
                <span className="tab-pick-check">{tab.id === current && <CheckIcon />}</span>
              </button>
            </div>
          ))}
        </div>
      </Popover>
    </div>
  );
}

export default TabDeck;
