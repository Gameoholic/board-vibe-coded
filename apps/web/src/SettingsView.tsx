import { POINTS_PER_PERCENT } from "@board/contracts";
import { useEffect, useRef, useState } from "react";
import BackupSlots from "./BackupSlots";
import ConfirmPopover from "./ConfirmPopover";
import { useClickOutside } from "./useClickOutside";
import type { DisplayTrigger, PointsFormula, Settings, StreakView, WindDown } from "./types";
import type { CardLayout } from "./useLocalConfig";

// A whole-number input that lets you type/clear freely and commits on blur (or Enter). A plain
// controlled `value={number}` that commits every keystroke fought the user — clearing the field
// parsed to 0 and snapped back, so you couldn't replace the value. Local text state fixes that; it
// re-syncs to an external change only while unfocused (so a server reconcile doesn't clobber typing).
// Also for a value whose passing steps must never be saved (typing 12 passes through 1).
function CommitWholeField({
  value,
  onCommit,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  className = "backfill-input",
}: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  const commit = () => {
    focused.current = false;
    const n = Number(text);
    if (Number.isInteger(n) && n >= min && n <= max) onCommit(n);
    else setText(String(value)); // revert empty/invalid
  };
  return (
    <input
      type="number"
      min={min}
      max={max === Number.MAX_SAFE_INTEGER ? undefined : max}
      className={className}
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

// A whole number within [min, max], saved as it's typed (anything else isn't saved).
function WholeField({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={1}
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isInteger(n) && n >= min && n <= max) onChange(n);
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
  // This device's tab placements — a backup's preview draws its board the way this board is laid out.
  layouts: Record<string, CardLayout>;
  // Whether the weekend sale is on now, and starting it early (it then runs until the week ends).
  saleRunning: boolean;
  onStartSale: () => void;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// How often a backup can be taken, in hours, with how each reads after "Back up every".
const BACKUP_PACES: { hours: number; label: string }[] = [
  { hours: 6, label: "6 hours" },
  { hours: 12, label: "12 hours" },
  { hours: 24, label: "day" },
  { hours: 48, label: "2 days" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "week" },
];

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

// A moment of the week: a weekday and a time, side by side (the weekend sale's start and end).
function WeekMomentField({
  label,
  day,
  minutes,
  onChange,
}: {
  label: string;
  day: number;
  minutes: number;
  onChange: (day: number, minutes: number) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="week-moment">
        <select value={day} aria-label={`${label}: day`} onChange={(e) => onChange(Number(e.target.value), minutes)}>
          {WEEKDAYS.map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
        <input
          type="time"
          value={toHHMM(minutes)}
          aria-label={`${label}: time`}
          onChange={(e) => {
            const m = fromHHMM(e.target.value);
            if (m !== null) onChange(day, m);
          }}
        />
      </div>
    </div>
  );
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
  layouts,
  saleRunning,
  onStartSale,
}: SettingsViewProps) {
  const [confirming, setConfirming] = useState(false);
  const resetRef = useRef<HTMLDivElement>(null);
  useClickOutside(resetRef, () => setConfirming(false), confirming);
  const [confirmingKeep, setConfirmingKeep] = useState(false);
  const resetKeepRef = useRef<HTMLDivElement>(null);
  useClickOutside(resetKeepRef, () => setConfirmingKeep(false), confirmingKeep);

  // Send the whole windDown object each time (the server shallow-merges the top-level patch).
  const patchWind = (patch: Partial<WindDown>) => onSave({ windDown: { ...settings.windDown, ...patch } });
  const patchBounty = (patch: Partial<Settings["bounty"]>) => onSave({ bounty: { ...settings.bounty, ...patch } });
  const patchFreezer = (patch: Partial<Settings["freezer"]>) => onSave({ freezer: { ...settings.freezer, ...patch } });
  const patchBooster = (patch: Partial<Settings["booster"]>) => onSave({ booster: { ...settings.booster, ...patch } });
  const patchSale = (patch: Partial<Settings["sale"]>) => onSave({ sale: { ...settings.sale, ...patch } });
  const [confirmingSale, setConfirmingSale] = useState(false);
  const patchBackup = (patch: Partial<Settings["backup"]>) => onSave({ backup: { ...settings.backup, ...patch } });
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
  // the owner has edited it since load — we can't compare against `realNow` (it re-stamps each minute,
  // which would flip dirty on its own). Go and Back to now reload the page, so dirty resets naturally then.
  const [when, setWhen] = useState(() => toLocalInput(debugNow ?? realNow));
  const [dirty, setDirty] = useState(false);
  const isPinned = debugNow !== null;
  // Status shown at the left of the actions row: a pending edit awaits Go, else whether we're pretending
  // or on the real clock.
  const clockStatus = dirty ? "Press Go to jump there" : isPinned ? "Showing another time" : "Showing now";

  return (
    <div className="settings-view">
      <h1 className="settings-title">Settings</h1>

      <section className="settings-group">
        <h2 className="settings-heading">Days & weeks</h2>

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
          <span className="field-hint">Up late? Set it to when your day really ends.</span>
        </label>

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
        </label>
      </section>

      <section className="settings-group">
        <h2 className="settings-heading">Points</h2>
        <p className="settings-note">A task's points are its hours × % per hour × its effort.</p>

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
            Save…
          </button>
        </div>
      </section>

      <section className="settings-group">
        <h2 className="settings-heading">Freezer</h2>
        <p className="settings-note">
          At the end of each week, tasks that have waited too long freeze, and frozen tasks gather frost.
        </p>

        <label className="field">
          <span className="field-label">Days before a task freezes</span>
          <WholeField
            value={settings.freezer.freezeAfterDays}
            min={1}
            max={365}
            onChange={(freezeAfterDays) => patchFreezer({ freezeAfterDays })}
          />
          <span className="field-hint">Counted while it waits in the Backlog or Blocked.</span>
        </label>

        <label className="field">
          <span className="field-label">Frost a week (% of its points)</span>
          <FloatField
            value={settings.freezer.frostPerWeek}
            onChange={(n) => {
              if (n >= 0 && n <= 1000) patchFreezer({ frostPerWeek: n });
            }}
          />
          <span className="field-hint">Each day on ice earns a seventh of it.</span>
        </label>

        <label className="field">
          <span className="field-label">Frost maxes at (% of its points)</span>
          <FloatField
            value={settings.freezer.frostCap}
            onChange={(n) => {
              if (n >= 1 && n <= 10_000) patchFreezer({ frostCap: n });
            }}
          />
        </label>

        <label className="field">
          <span className="field-label">A Subzero task pays (%)</span>
          <FloatField
            value={settings.freezer.subzeroMin / POINTS_PER_PERCENT}
            onChange={(n) => {
              if (n >= 0) patchFreezer({ subzeroMin: Math.round(n * POINTS_PER_PERCENT) });
            }}
          />
          <span className="field-hint">A task turns Subzero once its frost maxes out.</span>
        </label>

        <label className="field">
          <span className="field-label">Thaw bonus (%)</span>
          <FloatField
            value={settings.freezer.thawBonus / POINTS_PER_PERCENT}
            onChange={(n) => {
              if (n >= 0) patchFreezer({ thawBonus: Math.round(n * POINTS_PER_PERCENT) });
            }}
          />
          <span className="field-hint">
            Thawing a task moves it to In progress, and it keeps its frost. A frosted task earns this when thawed,
            unless it leaves In progress before it's done.
          </span>
        </label>
      </section>

      <section className="settings-group">
        <h2 className="settings-heading">Bounty</h2>
        <p className="settings-note">
          Each week, a Bounty is rolled from your frozen tasks; the longer one's been on ice, the likelier it is.
          It's worth more until the week ends.
        </p>

        <label className="field field-toggle">
          <span className="field-label">Enable Bounties</span>
          <input
            type="checkbox"
            className="settings-switch"
            checked={settings.bounty.enabled}
            onChange={(e) => patchBounty({ enabled: e.target.checked })}
          />
        </label>

        {settings.bounty.enabled && (
          <>
            <label className="field">
              <span className="field-label">Bounties at a time</span>
              <WholeField value={settings.bounty.max} min={1} max={5} onChange={(max) => patchBounty({ max })} />
            </label>

            <label className="field">
              <span className="field-label">Bounty point multiplier (×)</span>
              <FloatField
                value={settings.bounty.multiplier}
                onChange={(n) => {
                  if (n >= 1 && n <= 10) patchBounty({ multiplier: n });
                }}
              />
            </label>

            <label className="field">
              <span className="field-label">Free rerolls a week</span>
              <WholeField value={settings.bounty.rerolls} min={0} max={10} onChange={(rerolls) => patchBounty({ rerolls })} />
            </label>

            <label className="field field-toggle">
              <span className="field-label">Roll a new Bounty if you finish one mid-week</span>
              <input
                type="checkbox"
                className="settings-switch"
                checked={settings.bounty.rollOnWin}
                onChange={(e) => patchBounty({ rollOnWin: e.target.checked })}
              />
            </label>
          </>
        )}
      </section>

      <section className="settings-group">
        <h2 className="settings-heading">Booster</h2>
        <p className="settings-note">
          Each week, you draw a Booster from your Registry. It's worth more until the week ends.
        </p>

        <label className="field field-toggle">
          <span className="field-label">Enable Booster</span>
          <input
            type="checkbox"
            className="settings-switch"
            checked={settings.booster.enabled}
            onChange={(e) => patchBooster({ enabled: e.target.checked })}
          />
        </label>

        {settings.booster.enabled && (
          <>
            <label className="field">
              <span className="field-label">Boosters at a time</span>
              <WholeField value={settings.booster.max} min={1} max={3} onChange={(max) => patchBooster({ max })} />
            </label>

            <label className="field">
              <span className="field-label">Booster point bonus (%)</span>
              <FloatField
                value={settings.booster.amount / POINTS_PER_PERCENT}
                onChange={(n) => {
                  const amount = Math.round(n * POINTS_PER_PERCENT);
                  if (amount >= 1 && amount <= 10_000) patchBooster({ amount });
                }}
              />
              <span className="field-hint">Added every time you tick its task.</span>
            </label>
          </>
        )}
      </section>

      <section className="settings-group">
        <h2 className="settings-heading">Weekend sale</h2>
        <p className="settings-note">Rewards on the weekend sale cost less until the week ends.</p>

        <label className="field field-toggle">
          <span className="field-label">Enable weekend sale</span>
          <input
            type="checkbox"
            className="settings-switch"
            checked={settings.sale.enabled}
            onChange={(e) => patchSale({ enabled: e.target.checked })}
          />
        </label>

        {settings.sale.enabled && (
          <>
            <label className="field">
              <span className="field-label">Discount (%)</span>
              <WholeField value={settings.sale.percentOff} min={1} max={100} onChange={(percentOff) => patchSale({ percentOff })} />
            </label>
            <WeekMomentField
              label="Starts"
              day={settings.sale.startDay}
              minutes={settings.sale.startMinutes}
              onChange={(startDay, startMinutes) => patchSale({ startDay, startMinutes })}
            />
            {saleRunning ? (
              <p className="settings-note">On now, until the week ends.</p>
            ) : (
              <div className="popover-anchor">
                <button type="button" className="ghost-btn" onClick={() => setConfirmingSale(true)}>
                  Start the sale now
                </button>
                <ConfirmPopover
                  open={confirmingSale}
                  message="Start the weekend sale now? It runs until the week ends."
                  confirmLabel="Start"
                  danger={false}
                  onConfirm={() => {
                    setConfirmingSale(false);
                    onStartSale();
                  }}
                  onCancel={() => setConfirmingSale(false)}
                />
              </div>
            )}
          </>
        )}
      </section>

      <section className="settings-group">
        <h2 className="settings-heading">Wind-down</h2>
        <p className="settings-note">A reminder to get off your screens. It grows as the time gets closer.</p>

        <label className="field field-toggle">
          <span className="field-label">Enable wind-down</span>
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
              <span className="field-label">When it pops up</span>
              <div className="trigger-list">
                {sortedTriggers(settings.windDown.displayTriggers).map((t) => (
                  <span className="trigger-chip" key={t.kind === "refresh" ? "refresh" : `b${t.minutes}`}>
                    {t.kind === "refresh" ? "When I open the board" : `${t.minutes} min before`}
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
                  <span className="field-hint">With no times, it never pops up. Only the candle shows.</span>
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
                <span className="trigger-unit">min before</span>
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
                  Add
                </button>
                {!settings.windDown.displayTriggers.some((t) => t.kind === "refresh") && (
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() =>
                      patchWind({ displayTriggers: [...settings.windDown.displayTriggers, { kind: "refresh" }] })
                    }
                  >
                    Add “When I open the board”
                  </button>
                )}
              </div>
              {settings.windDown.displayTriggers.length > 0 && (
                <span className="field-hint">In between, it waits as a candle on the board.</span>
              )}
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
            </label>
          </>
        )}
      </section>

      <section className="settings-group">
        <h2 className="settings-heading">Streak data backfill</h2>
        <p className="settings-note">Streak data you kept before using this app.</p>
        {streaks.length === 0 ? (
          <p className="settings-note">No streaks yet.</p>
        ) : (
          streaks.map((s) => (
            <div className="field" key={s.id}>
              <span className="field-label">{s.name}</span>
              <div className="backfill-inputs">
                <label className="backfill-cell">
                  <span className="backfill-cell-label">Start</span>
                  <CommitWholeField value={s.legacy} onCommit={(n) => onBackfillStreak(s.id, { legacy: n })} />
                </label>
                {s.type !== "counter" && (
                  <label className="backfill-cell">
                    <span className="backfill-cell-label">Best</span>
                    <CommitWholeField value={s.legacyBest} onCommit={(n) => onBackfillStreak(s.id, { legacyBest: n })} />
                  </label>
                )}
              </div>
            </div>
          ))
        )}
      </section>

      <section className="settings-group">
        <h2 className="settings-heading">Debug</h2>
        <p className="settings-note">See the board as it would be at another time.</p>
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
              Back to now
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
            Go
          </button>
        </div>
      </section>

      <section className="settings-group">
        <h2 className="settings-heading">Backups</h2>
        <p className="settings-note">
          A full copy of everything here: your tabs, tasks, streaks, shop, settings and all your history.
        </p>

        <label className="field field-toggle">
          <span className="field-label">Back up automatically</span>
          <input
            type="checkbox"
            className="settings-switch"
            checked={settings.backup.enabled}
            onChange={(e) => patchBackup({ enabled: e.target.checked })}
          />
        </label>

        {settings.backup.enabled && (
          <>
            <label className="field">
              <span className="field-label">Back up every</span>
              <select value={settings.backup.everyHours} onChange={(e) => patchBackup({ everyHours: Number(e.target.value) })}>
                {BACKUP_PACES.map((pace) => (
                  <option key={pace.hours} value={pace.hours}>
                    {pace.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Backups to keep</span>
              {/* Saved once typed, not per keystroke — a passing 1 on the way to 12 would drop all but one. */}
              <CommitWholeField
                value={settings.backup.keep}
                min={1}
                max={20}
                className=""
                onCommit={(keep) => patchBackup({ keep })}
              />
            </label>
          </>
        )}

        <BackupSlots settings={settings.backup} timeZone={settings.timeZone} realNow={realNow} layouts={layouts} />
      </section>

      <section className="settings-group danger">
        <h2 className="settings-heading">Reset</h2>

        <p className="settings-note">
          Clears your history, points and streak counts. Your tabs, tasks, shop and settings stay. This can't be
          undone.
        </p>
        <div className="popover-anchor" ref={resetKeepRef}>
          <button type="button" className="danger-btn" onClick={() => setConfirmingKeep(true)}>
            Reset progress
          </button>
          <ConfirmPopover
            open={confirmingKeep}
            message="Clear your history, points and streak counts? Your tabs, tasks, shop and settings stay."
            confirmLabel="Reset progress"
            onConfirm={() => {
              setConfirmingKeep(false);
              onResetKeepBoard();
            }}
            onCancel={() => setConfirmingKeep(false)}
          />
        </div>

        <p className="settings-note">Deletes everything and leaves an empty board. This can't be undone.</p>
        <div className="popover-anchor" ref={resetRef}>
          <button type="button" className="danger-btn" onClick={() => setConfirming(true)}>
            Reset board
          </button>
          <ConfirmPopover
            open={confirming}
            message="Delete everything on the board?"
            confirmLabel="Delete everything"
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
