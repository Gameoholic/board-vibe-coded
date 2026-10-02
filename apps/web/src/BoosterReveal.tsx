import { motion } from "framer-motion";
import { useState } from "react";
import { BoosterDeal } from "./BoosterDeal";
import type { BoosterHand } from "./types";

interface BoosterRevealProps {
  hand: BoosterHand;
  onPick: (card: number) => Promise<BoosterHand | null>;
  onClose: () => void;
}

// This week's Booster hand when a pick was left (the board was reloaded before it was made): dealt again over
// the board, in a card like the recap's, to pick from. The board reads its tasks back once it's closed.
export function BoosterReveal({ hand, onPick, onClose }: BoosterRevealProps) {
  const [landed, setLanded] = useState(false);
  return (
    <div className="recap-scrim" onClick={onClose}>
      <motion.div
        className="recap-card booster-reveal"
        role="dialog"
        aria-label="This week's Booster"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
      >
        <div className="recap-head">
          <span className="recap-kicker">This week's Booster</span>
        </div>
        <BoosterDeal hand={hand} onPick={onPick} onLanded={() => setLanded(true)} />
        <div className="recap-foot">
          <div className="recap-nav">
            <button type="button" className="btn-primary" disabled={!landed} onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
