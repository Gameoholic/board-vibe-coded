import type { GameItemId } from "./types";

// The items an Item reward can give, as the shop shows them: what the add form and the inventory call each,
// and the name and emoji a new one starts with (the owner's to change). What buying one does is the server's
// (BoardStore's item grants). A new item is one entry here and one there.
export const GAME_ITEMS: Record<GameItemId, { label: string; emoji: string }> = {
  "bounty-reroll": { label: "Bounty reroll", emoji: "🎯" },
  "booster-reroll": { label: "Booster reroll", emoji: "🃏" },
};

export const GAME_ITEM_IDS = Object.keys(GAME_ITEMS) as GameItemId[];
