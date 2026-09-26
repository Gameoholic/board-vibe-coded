import { useEffect, useRef, useState } from "react";
import ConfirmPopover from "./ConfirmPopover";
import { useClickOutside } from "./useClickOutside";
import type { DisplayTrigger, PointsFormula, Settings, StreakView, WindDown } from "./types";

// A whole-number input that lets you type/clear freely and commits on blur (or Enter). A plain
// controlled `value={number}` that commits every keystroke fought the user — clearing the field
// parsed to 0 and snapped back, so you couldn't replace the value. Local text state fixes that; it
// re-syncs to an external change only while unfocused (so a server reconcile doesn't clobber typing).
function BackfillInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  const commit = () => {
    focused.current = false;
    const n = Number(text);
    if (Number.isInteger(n) && n >= 0) onCommit(n);
    else setText(String(value)); // revert empty/invalid
  };
  return (
    <input
      type="number"
      min={0}
      className="backfill-input"
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

// A positive-number input that lets you type decimals freely (keeps its own text so "2." doesn't snap
// to 2), reporting the parsed value live (NaN while blank/invalid, which the caller treats as invalid).
function FloatField({ value, onChange, className }: { value: number; onChange: (n: number) => void; className?: string }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  return (
    <input
      type="number"
      min={0}
      step="any"
      className={className}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
      }}
      onChange={(e) => {
        setText(e.target.value);
        onChange(Number(e.target.value));
      }}
    />
  );
}

interface SettingsViewProps {
  settings: Settings;
  // Each control persists its own field immediately (no save button), matching the tab-color pattern.
  onSave: (patch: Partial<Settings>) => void;
  // Request a points-formula change; App previews it, then shows the rebalance confirm dialog.
  onApplyFormula: (formula: PointsFormula) => void;
  // Every streak, so the backfill list can set each one's carried-over starting value.
  streaks: StreakView[];
  onBackfillStreak: (id: string, patch: { legacy?: number; legacyBest?: number }) => void;
  // Wipe everything to an empty board.
  onReset: () => void;
  // Wipe all history/progress but rebuild the current tabs/tasks/streaks.
  onResetKeepBoard: () => void;
  // Debug clock: the pinned instant (null = real time) and the server's real clock, plus a setter
  // that pins/clears it and reloads. Lets the owner simulate opening the app at another time.
  debugNow: string | null;
  realNow: string;
  onSetDebugClock: (at: string | null) => void;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The platform gives us the canonical zone list — no bundled table to maintain, no outbound call.
// Accessed through a cast since the TS lib in use may not type `supportedValuesOf` yet; guarded so a
// browser without it falls back to a free-text input.
const intlWithZones = Intl as { supportedValuesOf?: (key: "timeZone") => string[] };
const TIME_ZONES: string[] = intlWithZones.supportedValuesOf?.("timeZone") ?? [];

// minutes-past-midnight ↔ "HH:MM" for the native time input, which speaks the latter.
function toHHMM(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
function fromHHMM(value: string): number | null {
  const [h, m] = value.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  return h * 60 + m;
}

// Wind-down display-trigger list helpers (pure). Shown "before" first (earliest/largest at top),
// "refresh" last; adding a duplicate minute is a no-op.
function sortedTriggers(list: DisplayTrigger[]): DisplayTrigger[] {
  return [...list].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "before" ? -1 : 1;
    if (a.kind === "before" && b.kind === "before") return b.minutes - a.minutes;
    return 0;
  });
}
function addBefore(list: DisplayTrigger[], minutes: number): DisplayTrigger[] {
  if (list.some((t) => t.kind === "before" && t.minutes === minutes)) return list;
  return [...list, { kind: "before", minutes }];
}
function removeTrigger(list: DisplayTrigger[], target: DisplayTrigger): DisplayTrigger[] {
  return list.filter((t) =>
    target.kind === "refresh" ? t.kind !== "refresh" : !(t.kind === "before" && t.minutes === target.minutes),
  );
}

// An ISO instant → the "YYYY-MM-DDTHH:MM" local wall-clock string the datetime-local input speaks.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function SettingsView({
  settings,
  onSave,
  onApplyFormula,
  streaks,
  onBackfillStreak,
  onReset,
  onResetKeepBoard,
  debugNow,
  realNow,
  onSetDebugClock,
}: SettingsViewProps) {
  const [confirming, setConfirming] = useState(false);
  const resetRef = useRef<HTMLDivElement>(null);
  useClickOutside(resetRef, () => setConfirming(false), confirming);
  const [confirmingKeep, setConfirmingKeep] = useState(false);
  const resetKeepRef = useRef<HTMLDivElement>(null);
  useClickOutside(resetKeepRef, () => setConfirmingKeep(false), confirmingKeep);

  // Send the whole windDown object each time (the server shallow-merges the top-level patch).
  const patchWind = (patch: Partial<WindDown>) => onSave({ windDown: { ...settings.windDown, ...patch } });
  const [triggerDraft, setTriggerDraft] = useState("10");

  // The points formula is edited as a draft and applied via a Save button (unlike the per-field autosave
  // elsewhere) because saving it can rebalance every task — so it goes through a confirm dialog (App).
  const [formulaDraft, setFormulaDraft] = useState<PointsFormula>(settings.pointsFormula);
  useEffect(() => {
    setFormulaDraft(settings.pointsFormula);
  }, [settings.pointsFormula]);
  const formulaDirty = JSON.stringify(formulaDraft) !== JSON.stringify(settings.pointsFormula);
  const formulaValid =
    formulaDraft.ratePercentPerHour > 0 &&
    formulaDraft.effortLevels.every((l) => l.mult > 0 && l.label.trim().length > 0);
  const setLevel = (i: number, patch: Partial<{ label: string; mult: number }>) =>
    setFormulaDraft((f) => ({ ...f, effortLevels: f.effortLevels.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  // Prefill the debug input with the current effective time (pinned or real). `dirty` tracks whether
  // the user has edited it since load — we can't compare against `realNow` (it re-stamps each minute,
  // which would flip dirty on its own). Refresh/Reset reload the page, so dirty resets naturally then.
  const [when, setWhen] = useState(() => toLocalInput(debugNow ?? realNow));
  const [dirty, setDirty] = useState(false);
  const isPinned = debugNow !== null;
  // Status shown at the left of the actions row: a pending edit awaits a refresh, else whether we're
  // pretending or synced to the real machine clock.
  const clockStatus = dirty
    ? "Refresh to take effect"
    : isPinned
      ? "Pretending to be another time"
      : "Synced to your computer's clock";

  return (
    <div className="settings-view">
      <h1 className="settings-title">Settings</h1>

      <section className="settings-group">
        <h2 className="settings-heading">Time</h2>
        <p className="settings-note">
          Used to know when the days and weeks end.
        </p>

        <label className="field">
          <span className="field-label">Timezone</span>
          {TIME_ZONES.length > 0 ? (
            <select value={settings.timeZone} onChange={(e) => onSave({ timeZone: e.target.value })}>
              {TIME_ZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={settings.timeZone}
              onChange={(e) => onSave({ timeZone: e.target.value.trim() })}
            />
          )}
        </label>
      </section>

      <section className="settings-group">
        <h2 className="settings-heading">Day</h2>
        <label className="field">
          <span className="field-label">A new day starts at</span>
          <input
            type="time"
            value={toHHMM(settings.dayStartMinutes)}
            onChange={(e) => {
              const m = fromHHMM(e.target.value);
              if (m !== null) onSave({ dayStartMinutes: m });
            }}
          />
          <span className="field-hint">
           If the board is opened past this time, will prompt the user to start a new day.
          </span>
        </label>
      </section>

      <section className="settings-group">
        <h2 className="settings-heading">Week</h2>
        <label className="field">
          <span className="field-label">A new week starts on</span>
          <select
            value={settings.weekStartDay}
            onChange={(e) => onSave({ weekStartDay: Number(e.target.value) })}
          >
            {WEEKDAYS.map((day, i) => (
              <option key={day} value={i}>
                {day}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">…at</span>
          <input
            type="time"
            value={toHHMM(settings.weekStartMinutes)}
            onChange={(e) => {
              const m = fromHHMM(e.target.value);
              if (m !== null) onSave({ weekStartMinutes: m });
            }}
          />
          <span className="field-hint">
           If the board is opened past this time, will prompt the user to start a new week.
          </span>
        </label>
      </section>

      <section className="settings-group">
        <h2 className="settings-heading">Points</h2>
        <p className="settings-note">
          How the builder turns a task's time into a % score: <em>% = hours × rate × effort</em>. Changing
          this lets you rebalance every task whose % came from the builder — tasks with a hand-typed % or
          no time estimate are left alone, and points already earned on past completions never change.
        </p>

        <label className="field">
          <span className="field-label">% per hour</span>
          <FloatField
            value={formulaDraft.ratePercentPerHour}
            onChange={(n) => setFormulaDraft((f) => ({ ...f, ratePercentPerHour: n }))}
          />
        </label>

        <div className="field">
          <span className="field-label">Effort multipliers</span>
          <div className="effort-rows">
            {formulaDraft.effortLevels.map((lvl, i) => (
              <div className="effort-row" key={i}>
                <input
                  type="text"
                  className="effort-label"
                  value={lvl.label}
                  onChange={(e) => setLevel(i, { label: e.target.value })}
                />
                <span className="effort-x">×</span>
                <FloatField className="effort-mult" value={lvl.mult} onChange={(n) => setLevel(i, { mult: n })} />
              </div>
            ))}
          </div>
        </div>

        <div className="popover-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={!formulaDirty || !formulaValid}
            onClick={() => onApplyFormula(formulaDraft)}
          >
            Save & rebalance…
          </button>
        </div>
      </section>

      <section className="settings-group">
        <h2 className="settings-heading">Wind-down</h2>
        <p className="settings-note">
          As a chosen time nears, an alert grows on screen — small at first, then taking over the whole
          screen — to push you to shut your screens off. You can snooze or dismiss it any time.
        </p>

        <label className="field field-toggle">
          <span className="field-label">Enable the wind-down nudge</span>
          <input
            type="checkbox"
            className="settings-switch"
            checked={settings.windDown.enabled}
            onChange={(e) => patchWind({ enabled: e.target.checked })}
          />
        </label>

        {settings.windDown.enabled && (
          <>
            <label className="field">
              <span className="field-label">Be off your screens by</span>
              <input
                type="time"
                value={toHHMM(settings.windDown.targetMinutes)}
                onChange={(e) => {
                  const m = fromHHMM(e.target.value);
                  if (m !== null) patchWind({ targetMinutes: m });
                }}
              />
            </label>

            <div className="field">
              <span className="field-label">When to show the message on screen</span>
              <div className="trigger-list">
                {sortedTriggers(settings.windDown.displayTriggers).map((t) => (
                  <span className="trigger-chip" key={t.kind === "refresh" ? "refresh" : `b${t.minutes}`}>
                    {t.kind === "refresh" ? "On refresh" : `${t.minutes} min before`}
                    <button
                      type="button"
                      aria-label="Remove"
                      onClick={() => patchWind({ displayTriggers: removeTrigger(settings.windDown.displayTriggers, t) })}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {settings.windDown.displayTriggers.length === 0 && (
                  <span className="field-hint">Never shows the full message — only the candle.</span>
                )}
              </div>
              <div className="trigger-add">
                <input
                  type="number"
                  min={0}
                  max={1439}
                  className="backfill-input"
                  value={triggerDraft}
                  onChange={(e) => setTriggerDraft(e.target.value)}
                />
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    const n = Number(triggerDraft);
                    if (Number.isInteger(n) && n >= 0 && n <= 1439) {
                      patchWind({ displayTriggers: addBefore(settings.windDown.displayTriggers, n) });
                    }
                  }}
                >
                  Add “min before”
                </button>
                {!settings.windDown.displayTriggers.some((t) => t.kind === "refresh") && (
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() =>
                      patchWind({ displayTriggers: [...settings.windDown.displayTriggers, { kind: "refresh" }] })
                    }
                  >
                    Add “on refresh”
                  </button>
                )}
              </div>
              <span className="field-hint">
                Each “min before” pops the full message at that point; “on refresh” pops it on any page
                load once you're already inside the window. Between pops it stays as the candle.
              </span>
            </div>

            <label className="field">
              <span className="field-label">Message</span>
              <input
                type="text"
                maxLength={200}
                placeholder="Time to shut down your screens."
                value={settings.windDown.message}
                onChange={(e) => patchWind({ message: e.target.value })}
              />
              <span className="field-hint">Optional — blank uses the default headline.</span>
            </label>
          </>
        )}
      </section>

      <section className="settings-group">
        <h2 className="settings-heading">Backfill</h2>
        <p className="settings-note">
          Carry values over from before the app — e.g. a run you kept on the physical whiteboard.{" "}
          <strong>Start</strong> is <em>added on top</em> of the current count (only when the streak
          counts from All time). <strong>Best</strong> is a static record floor — the shown best is the
          higher of it and what you've actually reached in the app (daily/weekly only).
        </p>
        {streaks.length === 0 ? (
          <p className="settings-note">No streaks yet.</p>
        ) : (
          streaks.map((s) => (
            <div className="field" key={s.id}>
              <span className="field-label">{s.name}</span>
              <div className="backfill-inputs">
                <label className="backfill-cell">
                  <span className="backfill-cell-label">Start</span>
                  <BackfillInput value={s.legacy} onCommit={(n) => onBackfillStreak(s.id, { legacy: n })} />
                </label>
                {s.type !== "counter" && (
                  <label className="backfill-cell">
                    <span className="backfill-cell-label">Best</span>
                    <BackfillInput value={s.legacyBest} onCommit={(n) => onBackfillStreak(s.id, { legacyBest: n })} />
                  </label>
                )}
              </div>
            </div>
          ))
        )}
      </section>

      <section className="settings-group">
        <h2 className="settings-heading">Debug</h2>
        <p className="settings-note">
          Simulate opening the app at another moment. Pick a date and time, then hit Refresh — the
          day/week prompts and streaks recompute as if it were then.
        </p>
        <label className="field">
          <span className="field-label">Pretend it's</span>
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => {
              setWhen(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        <div className="popover-actions">
          <span className="settings-status">{clockStatus}</span>
          {(isPinned || dirty) && (
            <button type="button" className="ghost-btn" onClick={() => onSetDebugClock(null)}>
              Reset to real time
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={!dirty}
            onClick={() => {
              const d = new Date(when);
              if (!Number.isNaN(d.getTime())) onSetDebugClock(d.toISOString());
            }}
          >
            Refresh
          </button>
        </div>
      </section>

      <section className="settings-group danger">
        <h2 className="settings-heading">Reset</h2>

        <p className="settings-note">
          Clears all history and progress but keeps your current tabs, tasks and streaks, rebuilding
          them fresh. This cannot be undone.
        </p>
        <div className="popover-anchor" ref={resetKeepRef}>
          <button type="button" className="danger-btn" onClick={() => setConfirmingKeep(true)}>
            Reset progress (keep board)
          </button>
          <ConfirmPopover
            open={confirmingKeep}
            message="Clear all history and progress, keeping your current board? This cannot be undone."
            confirmLabel="Reset progress"
            onConfirm={() => {
              setConfirmingKeep(false);
              onResetKeepBoard();
            }}
            onCancel={() => setConfirmingKeep(false)}
          />
        </div>

        <p className="settings-note">
          Wipes all tasks, data and history completely, leaving an empty board. This cannot be undone.
        </p>
        <div className="popover-anchor" ref={resetRef}>
          <button type="button" className="danger-btn" onClick={() => setConfirming(true)}>
            Reset board
          </button>
          <ConfirmPopover
            open={confirming}
            message="Wipe all tasks, data and history completely? This cannot be undone."
            confirmLabel="Reset everything"
            onConfirm={() => {
              setConfirming(false);
              onReset();
            }}
            onCancel={() => setConfirming(false)}
          />
        </div>
      </section>
    </div>
  );
}

export default SettingsView;
