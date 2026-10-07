import { DEFAULT_EFFORT_ID, effortMultOf, effortRank, formatPercent, parsePercent, pointsFromMinutes } from "@board/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatMinutes, readDuration } from "./duration";
import { useBoardClock } from "./useBoardClock";

// How wide a form holding the builder is: room for its sentence on one line ("1h 30m at Normal difficulty =
// 12.5%"), so it reads as one and typing a % can't push its end to a second line.
export const POINTS_FORM_WIDTH = 350;

const DURATION_PRESETS = [2, 5, 15, 30, 60, 120] as const;
const isPreset = (minutes: number | null) => DURATION_PRESETS.some((p) => p === minutes);

// An effort's colour by where it sits on the scale, lightest to hardest — never by its name, which is the
// owner's to change. Only the builder's own marks wear it: a task's bracket is coloured by modifiers alone.
const EFFORT_TONES = ["var(--good-text)", "var(--text-2)", "var(--heat-ink)", "var(--danger-text)"];
function effortTone(rank: number, levels: number): string {
  const at = levels > 1 ? (Math.max(rank, 0) / (levels - 1)) * (EFFORT_TONES.length - 1) : 1;
  return EFFORT_TONES[Math.round(at)];
}

// What the builder reports up: the picked duration (null ≡ none → no estimate), which effort level it
// used, and whether the current % still equals what that duration+effort produces at the live formula
// ("builder") or was typed to something else ("manual"). The parent stores all three on the task/tier.
export interface BuilderEstimate {
  minutes: number | null;
  effort: string;
  source: "builder" | "manual";
}

interface PointsBuilderProps {
  points: string;
  // Must be a stable setter (a useState dispatcher) — it's an effect dependency.
  onPointsChange: (v: string) => void;
  // Optional: reports {minutes, effort, source} on every change. Must be stable (effect dep).
  onBuilderChange?: (info: BuilderEstimate) => void;
  // Optional seed for editing: preselect a builder value's duration/effort so it shows as chosen and
  // is reported as "builder". The initial auto-write is skipped, so seeding never clobbers the parent's
  // existing % (e.g. a manually-overridden one — don't seed those).
  initialMinutes?: number;
  initialEffort?: string;
  // What sits above the sentence: the field's label, or a tier's head (TierBuilderRow).
  heading?: React.ReactNode;
}

// A value's points as a sentence — "1h at Ugh difficulty = 3.75%" — each word a chip that opens its choices
// under the line: the time (presets, or type one: the field is focused as it opens) and the effort (the
// board's levels, each with its multiplier). Points is the single source of truth owned by the parent form;
// picking a time or an effort writes the % they come to via the live formula (Settings.pointsFormula), and a
// % typed over it stays, marked ≠ with the way back under it. The picks are local throwaway state — to
// clear them, remount with a changing `key`.
export default function PointsBuilder({ points, onPointsChange, onBuilderChange, initialMinutes, initialEffort, heading }: PointsBuilderProps) {
  const { settings } = useBoardClock();
  const formula = settings.pointsFormula;
  const [minutes, setMinutes] = useState<number | null>(initialMinutes ?? null);
  const [effort, setEffort] = useState(initialEffort ?? DEFAULT_EFFORT_ID);
  const [open, setOpen] = useState<"time" | "effort" | null>(null);
  // The typed time, as typed. Seeded for an edited task whose time isn't one of the presets.
  const [typed, setTyped] = useState(initialMinutes != null && !isPreset(initialMinutes) ? formatMinutes(initialMinutes) : "");
  const typedField = useRef<HTMLInputElement>(null);

  const built = minutes === null ? null : pointsFromMinutes(minutes, effortMultOf(formula, effort), formula);
  const byHand = built !== null && parsePercent(points) !== built;

  // Write the % whenever a time/effort is chosen (or the formula changes under them). Skips the first
  // run so a seeded (edit) builder doesn't overwrite the parent's existing % on mount.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    if (minutes !== null) {
      onPointsChange(String(pointsFromMinutes(minutes, effortMultOf(formula, effort), formula) / 1000));
    }
  }, [minutes, effort, formula, onPointsChange]);

  // Report source: "builder" when the current % equals the picked time+effort's output at the live
  // formula, else "manual" (a hand-typed %, or no time). Separate effect so writing points above and
  // reading it here don't loop.
  useEffect(() => {
    if (!onBuilderChange) return;
    const source =
      minutes !== null && parsePercent(points) === pointsFromMinutes(minutes, effortMultOf(formula, effort), formula)
        ? "builder"
        : "manual";
    onBuilderChange({ minutes, effort, source });
  }, [points, minutes, effort, formula, onBuilderChange]);

  // Opening the time goes straight to its field, so a time can be typed at once.
  useEffect(() => {
    if (open !== "time") return;
    typedField.current?.focus();
    typedField.current?.select();
  }, [open]);

  const typedRead = readDuration(typed);

  function typeTime(text: string) {
    setTyped(text);
    const read = readDuration(text);
    if (read.minutes !== null) setMinutes(read.minutes);
    // Emptied or unreadable: the typed time it replaced is gone; a preset picked earlier stays.
    else if (!isPreset(minutes)) setMinutes(null);
  }

  function pickPreset(preset: number) {
    // Picking the chosen preset again clears the time.
    setMinutes(minutes === preset ? null : preset);
    setTyped("");
    setOpen(null);
  }

  const levels = formula.effortLevels;
  const level = levels.find((l) => l.id === effort);
  const tone = (id: string) => ({ "--effort-tone": effortTone(effortRank(formula, id), levels.length) }) as React.CSSProperties;
  const toggle = (which: "time" | "effort") => setOpen(open === which ? null : which);

  return (
    <div
      className="field points-builder"
      onKeyDown={(e) => {
        // Esc closes the open choices, not the whole form.
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(null);
        }
      }}
    >
      {heading ?? <span className="field-label">Points</span>}
      <div className={`points-sentence${byHand ? " by-hand" : ""}`}>
        <button
          type="button"
          className={`sentence-chip${minutes === null ? " empty" : ""}${open === "time" ? " open" : ""}`}
          aria-expanded={open === "time"}
          onClick={() => toggle("time")}
        >
          {minutes === null ? "Time" : formatMinutes(minutes)}
        </button>
        <span className="sentence-word">at</span>
        <button
          type="button"
          className={`sentence-chip${open === "effort" ? " open" : ""}`}
          style={tone(effort)}
          aria-expanded={open === "effort"}
          onClick={() => toggle("effort")}
        >
          <i className="effort-dot" />
          {level?.label ?? "Effort"}
        </button>
        <span className="sentence-word">difficulty</span>
        <span className="sentence-result">
          <span className="sentence-word sentence-sign">{byHand ? "≠" : "="}</span>
          <label className="sentence-value">
            <input
              type="number"
              value={points}
              onChange={(e) => onPointsChange(e.target.value)}
              min="0"
              step="any"
              placeholder="0"
              required
              data-missing="Pick a time, or type a %"
              aria-label="Points"
              // As wide as what's typed, and never narrower than a usual % ("3.75"), so typing a shorter one
              // doesn't change what fits on the line.
              style={{ width: `${Math.max(4, points.length)}ch` }}
            />
            %
          </label>
        </span>
      </div>

      {open === "time" && (
        <div className="sentence-choices">
          {DURATION_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`calc-pill${minutes === preset ? " active" : ""}`}
              onClick={() => pickPreset(preset)}
            >
              {formatMinutes(preset)}
            </button>
          ))}
          <input
            ref={typedField}
            type="text"
            className={`typed-time${minutes !== null && !isPreset(minutes) ? " active" : ""}${typedRead.error ? " invalid" : ""}`}
            value={typed}
            placeholder="Other"
            aria-label="Other time"
            aria-invalid={!!typedRead.error}
            autoComplete="off"
            onChange={(e) => typeTime(e.target.value)}
            onKeyDown={(e) => {
              // Enter is "done with the time", not "submit the form".
              if (e.key === "Enter") {
                e.preventDefault();
                setOpen(null);
              }
            }}
          />
          {typedRead.error && <span className="typed-time-error">{typedRead.error}</span>}
        </div>
      )}

      {open === "effort" && (
        <div className="sentence-choices effort-choices">
          {levels.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`effort-choice${effort === l.id ? " on" : ""}`}
              style={tone(l.id)}
              onClick={() => {
                setEffort(l.id);
                setOpen(null);
              }}
            >
              <span className="effort-choice-name">{l.label}</span>
              <span className="effort-choice-mult">×{l.mult}</span>
            </button>
          ))}
        </div>
      )}

      {byHand && built !== null && (
        <button type="button" className="ghost-btn or-use-btn" onClick={() => onPointsChange(String(built / 1000))}>
          Or use {formatPercent(built)}
        </button>
      )}
    </div>
  );
}

// One tier of a tiered task in a form: a stable id (so removing a tier never shifts the wrong builder),
// its % text, and its builder's report — minutes null ≡ no duration picked → no estimate stored.
export interface TierRow {
  id: string;
  points: string;
  est: BuilderEstimate;
}

interface TierBuilderRowProps {
  row: TierRow;
  index: number;
  onPointsChange: (id: string, points: string) => void;
  onEstimateChange: (id: string, est: BuilderEstimate) => void;
  // The add form's remove control; the edit form passes none, since there the tier count is fixed.
  onRemove?: (id: string) => void;
  canRemove?: boolean;
  // Edit form: the tier's saved duration/effort, preselected in its builder (see PointsBuilder).
  initialMinutes?: number;
  initialEffort?: string;
}

// One tier's builder — the same PointsBuilder sentence a checkbox task gets, under a "Tier N" head —
// shared by the add and edit forms. Its own component so its callbacks are stable per row (the builder
// treats them as effect dependencies) and each tier's duration/effort stays its own.
export function TierBuilderRow({
  row,
  index,
  onPointsChange,
  onEstimateChange,
  onRemove,
  canRemove = true,
  initialMinutes,
  initialEffort,
}: TierBuilderRowProps) {
  const handlePoints = useCallback((v: string) => onPointsChange(row.id, v), [row.id, onPointsChange]);
  const handleBuilder = useCallback((est: BuilderEstimate) => onEstimateChange(row.id, est), [row.id, onEstimateChange]);
  return (
    <div className="tier-builder-row">
      <PointsBuilder
        points={row.points}
        onPointsChange={handlePoints}
        onBuilderChange={handleBuilder}
        initialMinutes={initialMinutes}
        initialEffort={initialEffort}
        heading={
          <div className="tier-builder-head">
            <span className="tier-row-label">Tier {index + 1}</span>
            {onRemove && (
              <button type="button" className="icon-btn" aria-label="Remove tier" onClick={() => onRemove(row.id)} disabled={!canRemove}>
                ✕
              </button>
            )}
          </div>
        }
      />
    </div>
  );
}
