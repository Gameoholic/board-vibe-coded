// `crypto.randomUUID()` exists only in a **secure context** (HTTPS or localhost). Opening the board
// over a plain-HTTP LAN IP (e.g. http://10.0.0.20:5173 from another device) is an insecure context
// where it's `undefined` and throws — which blanked the whole app on that device while localhost was
// fine. This returns a good-enough client id everywhere. These ids are local (React keys, a flyer id),
// never security-sensitive, so the non-crypto fallback is acceptable.
export function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
