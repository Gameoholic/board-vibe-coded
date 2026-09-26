import { useEffect } from "react";

// 1Password / LastPass attach an inline "unlock / fill" menu to form fields. In a self-hosted,
// login-less app that's pure noise on every points/name/time input. They honour `data-1p-ignore` /
// `data-lpignore` PER FIELD but offer no global opt-out — so rather than stamp every <input> by hand
// (and miss the next one added), we stamp them all once and watch for dynamically-mounted ones
// (popover forms mount/unmount constantly). One home for the suppression; new inputs are covered free.
function stamp(el: Element) {
  el.setAttribute("data-1p-ignore", "");
  el.setAttribute("data-lpignore", "true");
}

function stampAll(root: ParentNode) {
  root.querySelectorAll("input, textarea, select").forEach(stamp);
}

export function useSuppressPasswordManagers() {
  useEffect(() => {
    stampAll(document);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) {
            continue;
          }
          if (node.matches("input, textarea, select")) {
            stamp(node);
          }
          stampAll(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}
