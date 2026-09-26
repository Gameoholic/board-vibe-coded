import { useRef, useState } from "react";
import Popover from "./Popover";
import { useClickOutside } from "./useClickOutside";
import type { CanvasSettings } from "./useLocalConfig";

interface CanvasToolbarProps {
  settings: CanvasSettings;
  onChange: (patch: Partial<CanvasSettings>) => void;
  onReset: () => void;
  // A canvas's own extra groups (e.g. the shop's "new tab"), shown before the shared grid/reset ones.
  children?: React.ReactNode;
}

// The grid step offered in the UI. Values are world px; snapping and the dot overlay both use
// whichever one is picked (see canvas.snap / BoardCanvas grid).
const GRID_SIZES: { label: string; value: number }[] = [
  { label: "S", value: 10 },
  { label: "M", value: 20 },
  { label: "L", value: 40 },
];

function GridIcon() {
  // A lattice (hash), not four tiles — the tiled version read as an app-launcher icon.
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function SettingRow({ label, control }: { label: string; control: React.ReactNode }) {
  return (
    <div className="setting-row">
      <span className="setting-label">{label}</span>
      {control}
    </div>
  );
}

function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      className={`switch${on ? " on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
    >
      <span className="switch-knob" />
    </button>
  );
}

// A toolbar icon button that opens its own inline popover — same shape as a tab's color/sort
// controls (popover-anchor > button + Popover), one per settings group. Exported so a canvas can add
// its own groups (see CanvasToolbar's children).
export function ToolbarGroup({
  icon,
  label,
  title,
  width,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  width: number;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  const close = () => setOpen(false);
  return (
    <div className="popover-anchor" ref={ref}>
      <button
        type="button"
        className={`toolbar-btn${open ? " open" : ""}`}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
      </button>
      <Popover title={title} open={open} onClose={close} align="right" width={width}>
        {children(close)}
      </Popover>
    </div>
  );
}

function CanvasToolbar({ settings, onChange, onReset, children }: CanvasToolbarProps) {
  return (
    <div className="canvas-toolbar">
      {children}
      <ToolbarGroup icon={<GridIcon />} label="Grid settings" title="Grid" width={244}>
        {() => (
          <div className="settings-menu">
            <SettingRow
              label="Snap to grid"
              control={<Toggle on={settings.snap} onToggle={() => onChange({ snap: !settings.snap })} label="Snap to grid" />}
            />
            <SettingRow
              label="Grid size"
              control={
                <div className="seg" role="group" aria-label="Grid size">
                  {GRID_SIZES.map((g) => (
                    <button
                      key={g.value}
                      type="button"
                      className={`seg-btn${settings.gridSize === g.value ? " active" : ""}`}
                      aria-pressed={settings.gridSize === g.value}
                      onClick={() => onChange({ gridSize: g.value })}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              }
            />
            <SettingRow
              label="Show grid"
              control={<Toggle on={settings.showGrid} onToggle={() => onChange({ showGrid: !settings.showGrid })} label="Show grid" />}
            />
          </div>
        )}
      </ToolbarGroup>

      <ToolbarGroup icon={<ResetIcon />} label="Reset tab positions" title="Reset" width={224}>
        {(close) => (
          <div className="reset-panel">
            <p>Discard this device's tab arrangement and rearrange every tab to the default layout?</p>
            <button
              type="button"
              className="danger-btn"
              onClick={() => {
                onReset();
                close();
              }}
            >
              Reset positions
            </button>
          </div>
        )}
      </ToolbarGroup>
    </div>
  );
}

export default CanvasToolbar;
