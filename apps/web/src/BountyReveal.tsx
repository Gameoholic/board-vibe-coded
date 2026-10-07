import { motion } from "framer-motion";
import { useState } from "react";
import { BountyRolls } from "./BountyRoll";
import type { BountyReel, BountyStatus, BountyStopped } from "./types";

interface BountyRevealProps {
  reel: BountyReel;
  rerollsLeft: number;
  onRoll: (spot: number) => Promise<BountyStopped | null>;
  onReroll: (taskId: string) => Promise<BountyStatus | null>;
  onClose: () => void;
}

// A Bounty to roll mid-week — another one as one was won, a row's Reroll, or a reel left unswung (the board
// was left before it was) — on its reel in a card over the board, like the recap's. It stays up until the
// reel has landed (its Skip is the quick way through), then Done or a click beside it closes it, and the
// board reads its tasks back.
export function BountyReveal({ reel, rerollsLeft, onRoll, onReroll, onClose }: BountyRevealProps) {
  const [landed, setLanded] = useState(false);
  return (
    <div className="recap-scrim" onClick={landed ? onClose : undefined}>
      <motion.div
        className="recap-card bounty-reveal"
        role="dialog"
        aria-label="New Bounty"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
      >
        <div className="recap-head">
          <span className="recap-kicker">{reel.rolls > 1 ? "New Bounties" : "New Bounty"}</span>
        </div>
        <BountyRolls status={{ bounties: [], rerollsLeft, reel }} onRoll={onRoll} onReroll={onReroll} onLandedChange={setLanded} />
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
