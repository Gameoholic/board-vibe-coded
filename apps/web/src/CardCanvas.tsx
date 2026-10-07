import { AnimatePresence } from "framer-motion";
import { useMemo, useState } from "react";
import BoardCanvas from "./BoardCanvas";
import CanvasToolbar from "./CanvasToolbar";
import type { CardFrame } from "./CanvasCard";
import TabDeck, { type TabFace } from "./TabDeck";
import { DOCK_CLEARANCE, MARGIN, placeCards } from "./canvas";
import type { CanvasSettings, CardLayout } from "./useLocalConfig";

// The shared base of every canvas (the board, the shop): a pannable/zoomable world of freely-placed
// cards with the canvas toolbar (grid/snap, reset positions) in its corner. It owns placement — each
// card's saved layout or a tidy default, the world size those imply, and the reset signal — and hands
// every card its CardFrame; what the cards are is the caller's (renderCard).
//
// Its other view is one tab at a time (the canvas settings' `oneTab`, the toolbar's switch): the tab the
// canvas is on fills the frame, docked, and the deck in the corner (TabDeck) turns to another. The points
// counter docks at the top of that view on every canvas, since a tab filling the frame leaves it no gap.

interface CardCanvasProps<T extends { id: string }> {
  name: string; // data-canvas on the viewport (see BoardCanvas)
  cards: T[]; // in default-arrangement order
  layouts: Record<string, CardLayout>; // saved placements (device-local), keyed by card id
  onLayoutChange: (id: string, layout: CardLayout) => void;
  onResetLayouts: (ids: string[]) => void;
  settings: CanvasSettings;
  onSettingsChange: (patch: Partial<CanvasSettings>) => void;
  // The points counter docks at this canvas's top-centre (the shop's), so its cards are arranged below it.
  dock?: boolean;
  toolbar?: React.ReactNode; // the canvas's own toolbar groups, before the shared ones
  // The one-tab view: what the deck shows of each card, the card it's on (absent or gone ≡ the first), and
  // turning to another.
  face: (card: T) => TabFace;
  shown: string | undefined;
  onShow: (id: string) => void;
  renderCard: (card: T, frame: CardFrame) => React.ReactNode; // must return a keyed card
}

function CardCanvas<T extends { id: string }>({
  name,
  cards,
  layouts,
  onLayoutChange,
  onResetLayouts,
  settings,
  onSettingsChange,
  dock = false,
  toolbar,
  face,
  shown,
  onShow,
  renderCard,
}: CardCanvasProps<T>) {
  // Each card's free-canvas placement: its saved layout, or a tidy default derived from order for
  // cards never moved yet. The world is just their bounding box plus a margin of slack — that's the
  // whole pannable area, so it grows only when a card is dropped further out.
  const placed = useMemo(() => placeCards(cards, layouts, dock ? DOCK_CLEARANCE : undefined), [cards, layouts, dock]);

  const world = useMemo(() => {
    let w = 0;
    let h = 0;
    for (const l of Object.values(placed)) {
      w = Math.max(w, l.x + l.w);
      h = Math.max(h, l.y + l.h);
    }
    return { w: w + MARGIN, h: h + MARGIN };
  }, [placed]);

  // Bumped by "reset positions" so each card animates back to its arranged spot. Motion values in
  // CanvasCard don't track the layout prop (a drag must not be overridden mid-flight), so a signal is
  // what tells them to re-sync — see the effect there.
  const [resetSignal, setResetSignal] = useState(0);
  function resetPositions() {
    onResetLayouts(cards.map((c) => c.id));
    setResetSignal((n) => n + 1);
  }

  const frameOf = (card: T, docked: boolean): CardFrame => ({
    layout: placed[card.id],
    resetSignal,
    onLayoutChange: (layout) => onLayoutChange(card.id, layout),
    docked,
  });
  const canvasToolbar = (
    <CanvasToolbar settings={settings} onChange={onSettingsChange} onReset={resetPositions}>
      {toolbar}
    </CanvasToolbar>
  );

  if (settings.oneTab) {
    const current = cards.find((c) => c.id === shown) ?? cards[0];
    return (
      <>
        {canvasToolbar}
        <div className="hud-dock" />
        {/* The same frame as the canvas's, so a mode that hides or dims a canvas (the shop over the board)
            needs no second rule for this view. */}
        <div className="board-viewport one-tab" data-canvas={name} style={{ paddingTop: DOCK_CLEARANCE }}>
          <AnimatePresence initial={false}>{current && renderCard(current, frameOf(current, true))}</AnimatePresence>
        </div>
        {current && cards.length > 1 && (
          <TabDeck tabs={cards.map((c) => ({ id: c.id, ...face(c) }))} current={current.id} onPick={onShow} />
        )}
      </>
    );
  }

  return (
    <>
      {canvasToolbar}
      {dock && <div className="hud-dock" />}
      <BoardCanvas name={name} worldW={world.w} worldH={world.h}>
        <AnimatePresence initial={false}>{cards.map((card) => renderCard(card, frameOf(card, false)))}</AnimatePresence>
      </BoardCanvas>
    </>
  );
}

export default CardCanvas;
