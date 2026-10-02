import { PlusIcon } from "./Icons";
import type { DisplayOption } from "./TabControls";

// Display options every tab kind offers, each under its own words.

// The tab's "+" add button (CardAdd): shown, or hidden — it then appears when the pointer is on its row.
// Off by default unless a tab kind says otherwise (`{ ...option, defaultOn }`).
export const ADD_BUTTON_KEY = "add";
export const addButtonOption = (noun: string): DisplayOption => ({
  key: ADD_BUTTON_KEY,
  label: `Add ${noun} button`,
  icon: PlusIcon,
});
