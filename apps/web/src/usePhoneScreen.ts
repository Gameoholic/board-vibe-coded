import { useSyncExternalStore } from "react";

// A phone-sized screen. The width is App.css's phone breakpoint (its "Phones and touch" rules); keep the two
// in step.
export const PHONE_SCREEN = "(max-width: 720px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE_SCREEN);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Whether the screen is phone-sized right now — it follows a window being resized or a phone turned. */
export function usePhoneScreen(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE_SCREEN).matches);
}
