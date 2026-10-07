import { useRef, useState } from "react";
import { formatElapsed } from "./duration";
import { TimerIcon } from "./Icons";
import Popover from "./Popover";
import { useClickOutside } from "./useClickOutside";
import type { StopwatchState } from "./useStopwatch";

// The app's stopwatch: start, pause, reset, or type the minutes over it — a button and its panel, drawn from a
// reading (useStopwatch). A task's timer (TaskTimer) and a timed reward's price tag are both this.

interface StopwatchProps {
  watch: StopwatchState;
  color: string;
  // The button that opens it, where the row draws its own (a timed reward's price tag). Otherwise it's the
  // clock and its reading.
  trigger?: (toggle: () => void) => React.ReactNode;
  // What the reading is for, under the stopwatch's own controls — a tier's Submit, a reward's Buy — handed
  // the way to close the panel.
  children?: (close: () => void) => React.ReactNode;
  // The anchor's place in its row.
  className?: string;
  align?: "left" | "right";
}

function Stopwatch({ watch, color, trigger, children, className = "timer-anchor", align = "right" }: StopwatchProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  // Minutes typed and left in the field are kept, however the panel closes.
  const close = () => {
    watch.keepTyped();
    setOpen(false);
  };
  const toggle = () => (open ? close() : setOpen(true));
  useClickOutside(anchorRef, close, open);

  return (
    <div className={`popover-anchor ${className}`} ref={anchorRef}>
      {trigger ? (
        trigger(toggle)
      ) : (
        <button type="button" className={`timer-btn${watch.running ? " running" : ""}`} aria-label="Timer" onClick={toggle}>
          <TimerIcon />
          {(watch.running || watch.elapsedMs > 0) && <span>{formatElapsed(watch.elapsedMs)}</span>}
        </button>
      )}
      <Popover title="Timer" open={open} onClose={close} align={align} width={210}>
        <div className="timer-popover">
          <span className="timer-display">{formatElapsed(watch.elapsedMs)}</span>
          <div className="timer-actions">
            {watch.running ? (
              <button type="button" className="ghost-btn" onClick={watch.pause}>
                Pause
              </button>
            ) : (
              <button type="button" className="ghost-btn" style={{ color }} onClick={watch.start}>
                {watch.elapsedMs > 0 ? "Resume" : "Start"}
              </button>
            )}
            <button type="button" className="ghost-btn" onClick={watch.reset} disabled={watch.elapsedMs === 0 && !watch.running}>
              Reset
            </button>
          </div>
          <input
            className="timer-manual-input"
            type="number"
            min="0"
            step="1"
            placeholder="Or type minutes"
            value={watch.typed}
            onChange={(e) => watch.setTyped(e.target.value)}
            onBlur={watch.keepTyped}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          {children?.(close)}
        </div>
      </Popover>
    </div>
  );
}

export default Stopwatch;
