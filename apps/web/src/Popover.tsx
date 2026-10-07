import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { useAnchoredPanel } from "./useTopLayer";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: number;
  // A menu whose rows mustn't wrap: as wide as its longest row needs, and never narrower than `width`.
  fit?: boolean;
  align?: "left" | "right";
  // Tall forms (add-task, streak) opt in: cap the panel to the window's height and scroll internally rather
  // than run past an edge. Off by default so short popovers that hold nested popovers of their own (color
  // picker, timer) aren't given an overflow.
  scrollable?: boolean;
}

// The one inline form/menu primitive: a panel anchored to the element it sits in (its `.popover-anchor`),
// opened in the top layer so a tab's scrolling list can't cut it off (see useTopLayer).
function Popover({ open, onClose, title, children, width = 280, fit = false, align = "left", scrollable = false }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { openUp, maxH } = useAnchoredPanel(ref, open, { align, scrollable });

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          popover="manual"
          className="popover"
          style={{
            ...(fit ? { minWidth: width, width: "max-content" } : { width }),
            ...(scrollable ? { maxHeight: maxH, overflowY: "auto" } : {}),
            transformOrigin: openUp ? "bottom" : "top",
          }}
          initial={{ opacity: 0, scale: 0.96, y: openUp ? 6 : -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: openUp ? 4 : -4 }}
          transition={{ duration: 0.14, ease: "easeOut" }}
        >
          <div className="popover-header">
            <span className="popover-title">{title}</span>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              ✕
            </button>
          </div>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default Popover;
