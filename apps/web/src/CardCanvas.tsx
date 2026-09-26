import { AnimatePresence } from "framer-motion";
import { useMemo, useState } from "react";
import BoardCanvas from "./BoardCanvas";
import CanvasToolbar from "./CanvasToolbar";
import type { CardFrame } from "./CanvasCard";
import { defaultLayout, MARGIN } from "./canvas";
import type { CanvasSettings, CardLayout } from "./useLocalConfig";

// The shared base of every canvas (the board, the shop): a pannable/zoomable world of freely-placed
// cards with the canvas toolbar (grid/snap, reset positions) in its corner. It owns placement — each
// card's saved layout or a tidy default, the world size those imply, and the reset signal — and hands
// every card its CardFrame; what the cards are is the caller's (renderCard).

interface CardCanvasProps<T extends { id: string }> {
  name: string; // data-canvas on the viewport (see BoardCanvas)
  cards: T[]; // in default-arrangement order
  layouts: Record<string, CardLayout>; // saved placements (device-local), keyed by card id
  onLayoutChange: (id: string, layout: CardLayout) => void;
  onResetLayouts: (ids: string[]) => void;
  settings: CanvasSettings;
  onSettingsChange: (patch: Partial<CanvasSettings>) => void;
  topInset?: number; // push the default arrangement down (see defaultLayout)
  toolbar?: React.ReactNode; // the canvas's own toolbar groups, before the shared ones
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
  topInset,
  toolbar,
  renderCard,
}: CardCanvasProps<T>) {
  // Each card's free-canvas placement: its saved layout, or a tidy default derived from order for
  // cards never moved yet. The world is just their bounding box plus a margin of slack — that's the
  // whole pannable area, so it grows only when a card is dropped further out.
  const placed = useMemo(() => {
    const map: Record<string, CardLayout> = {};
    cards.forEach((c, i) => {
      map[c.id] = layouts[c.id] ?? defaultLayout(i, cards.length, topInset);
    });
    return map;
  }, [cards, layouts, topInset]);

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

  return (
    <>
      <CanvasToolbar settings={settings} onChange={onSettingsChange} onReset={resetPositions}>
        {toolbar}
      </CanvasToolbar>
      <BoardCanvas name={name} worldW={world.w} worldH={world.h}>
        <AnimatePresence initial={false}>
          {cards.map((card) =>
            renderCard(card, {
              layout: placed[card.id],
              resetSignal,
              onLayoutChange: (layout) => onLayoutChange(card.id, layout),
            }),
          )}
        </AnimatePresence>
      </BoardCanvas>
    </>
  );
}

export default CardCanvas;
