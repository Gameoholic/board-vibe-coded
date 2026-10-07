import { createContext, useContext } from "react";
import { DEFAULT_SETTINGS, type CanvasSettings } from "./useLocalConfig";

// The per-device canvas knobs (snap, grid size, grid visibility) reach the two places that
// need them — SectionCard's commit (snapping) and BoardCanvas (the grid overlay) — through a
// context rather than prop-drilling. Read via the hook, never the context directly (frontend
// React convention). The default is useLocalConfig's DEFAULT_SETTINGS, so a consumer rendered
// outside the provider still behaves sanely.
const CanvasSettingsContext = createContext<CanvasSettings>(DEFAULT_SETTINGS);

export const CanvasSettingsProvider = CanvasSettingsContext.Provider;

export function useCanvasSettings(): CanvasSettings {
  return useContext(CanvasSettingsContext);
}
