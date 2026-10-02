import { motion } from "framer-motion";
import { useState } from "react";
import { BountyExplain, BountyRoll } from "./BountyRoll";
import type { RolledBounty } from "./types";

interface BountyRevealProps {
  bounty: RolledBounty;
  onReroll: () => void;
  onClose: () => void;
}

// A Bounty rolled mid-week — another one rolled as one was won, or a row's Reroll — revealed on its reel
// in a card over the board, like the recap's. The board reads its tasks back once it's closed, so the new
// one isn't given away before the reel lands.
export function BountyReveal({ bounty, onReroll, onClose }: BountyRevealProps) {
  const [landed, setLanded] = useState(false);
  return (
    <div className="recap-scrim" onClick={onClose}>
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
          <span className="recap-kicker">New Bounty</span>
        </div>
        {/* Keyed by the task it landed on, so a reroll spins the reel again. */}
        <BountyRoll key={bounty.taskId} bounty={bounty} onReroll={onReroll} onLanded={() => setLanded(true)} />
        <BountyExplain multiplier={bounty.multiplier} shown={landed} />
        <div className="recap-foot">
          <div className="recap-nav">
            <button type="button" className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
