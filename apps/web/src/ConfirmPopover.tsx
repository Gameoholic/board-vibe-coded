import { AnimatePresence, motion } from "framer-motion";

interface ConfirmPopoverProps {
  open: boolean;
  message: string;
  // The affirmative button's label — defaults to "Delete" since that's the common case (task/streak
  // removal); other destructive actions (e.g. reset) pass their own verb.
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmPopover({ open, message, confirmLabel = "Delete", onConfirm, onCancel }: ConfirmPopoverProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="confirm-backdrop" onClick={onCancel} />
          <motion.div
            className="confirm-popover"
            initial={{ opacity: 0, scale: 0.9, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -6 }}
            transition={{ type: "spring", stiffness: 460, damping: 30 }}
          >
            <p>{message}</p>
            <div className="confirm-popover-actions">
              <button type="button" className="ghost-btn" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" className="danger-btn" onClick={onConfirm}>
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default ConfirmPopover;
