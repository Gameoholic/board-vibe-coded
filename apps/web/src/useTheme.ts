import { useEffect, useState, useSyncExternalStore } from "react";

// How the app looks on this device: one of the themes (their colours are theme.css), or "system" to follow
// the device's own light/dark setting. Device-local like the canvas layout (useLocalConfig) — it's how this
// screen looks, not board truth — but under its own key, because index.html's boot script reads it before
// React loads to set the theme ahead of first paint. Keep that script in step with this file.

// `editor`: one of the well-known code-editor themes, listed apart from the board's own in the theme menu.
export const THEMES = [
  { id: "light", label: "Light", dark: false, editor: false },
  { id: "dark", label: "Dark", dark: true, editor: false },
  { id: "slate", label: "Slate", dark: true, editor: false },
  { id: "black", label: "Black", dark: true, editor: false },
  { id: "charcoal", label: "Charcoal", dark: true, editor: false },
  { id: "nord", label: "Nord", dark: true, editor: true },
  { id: "one-dark", label: "One Dark", dark: true, editor: true },
  { id: "tokyo-night", label: "Tokyo Night", dark: true, editor: true },
  { id: "solarized", label: "Solarized", dark: true, editor: true },
  { id: "gruvbox", label: "Gruvbox", dark: true, editor: true },
  { id: "monokai", label: "Monokai", dark: true, editor: true },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export type ThemeChoice = ThemeId | "system";

interface ThemePref {
  choice: ThemeChoice;
  // The dark theme the rail's toggle and "system" use: the last dark one picked.
  dark: ThemeId;
}

const KEY = "board-theme";
const DEFAULT_PREF: ThemePref = { choice: "system", dark: "dark" };
const DARK_QUERY = "(prefers-color-scheme: dark)";

const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);
export const isDarkTheme = (id: ThemeId) => THEMES.some((t) => t.id === id && t.dark);

function load(): ThemePref {
  try {
    const raw: Partial<Record<keyof ThemePref, unknown>> | null = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return {
      choice: raw?.choice === "system" || isTheme(raw?.choice) ? (raw.choice as ThemeChoice) : DEFAULT_PREF.choice,
      dark: isTheme(raw?.dark) && isDarkTheme(raw.dark) ? raw.dark : DEFAULT_PREF.dark,
    };
  } catch {
    return DEFAULT_PREF;
  }
}

function subscribeToSystem(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const systemIsDark = () => window.matchMedia(DARK_QUERY).matches;

export function useTheme() {
  const [pref, setPref] = useState(load);
  const systemDark = useSyncExternalStore(subscribeToSystem, systemIsDark);
  const theme: ThemeId = pref.choice === "system" ? (systemDark ? pref.dark : "light") : pref.choice;
  const dark = isDarkTheme(theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Picking a dark theme also makes it the one the toggle goes to.
  function choose(choice: ThemeChoice) {
    const next: ThemePref = { choice, dark: choice !== "system" && isDarkTheme(choice) ? choice : pref.dark };
    setPref(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  }

  return { theme, choice: pref.choice, dark, choose, toggle: () => choose(dark ? "light" : pref.dark) };
}
