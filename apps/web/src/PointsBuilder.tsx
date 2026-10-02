import { effortMultOf, parsePercent, pointsFromMinutes } from "@board/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBoardClock } from "./useBoardClock";

const DURATION_PRESETS = [
  { label: "<2m", minutes: 2 },
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 120 },
] as const;

// Seed the custom duration field from an edited task's saved minutes: blank for a preset value (its
// pill lights instead), else the value in whole hours when it divides evenly, otherwise minutes.
function seedCustom(mins: number | undefined): { unit: "h" | "m"; text: string } {
  if (mins == null || DURATION_PRESETS.some((p) => p.minutes === mins)) return { unit: "h", text: "" };
  if (mins % 60 === 0) return { unit: "h", text: String(mins / 60) };
  return { unit: "m", text: String(mins) };
}

// What the builder reports up: the picked duration (null ≡ none → no estimate), which effort preset it
// used, and whether the current % still equals what that duration+effort produces at the live formula
// ("builder") or was typed to something else ("manual"). The parent stores all three on the task/tier.
export interface BuilderEstimate {
  minutes: number | null;
  effortIndex: number;
  source: "builder" | "manual";
}

interface PointsBuilderProps {
  points: string;
  // Must be a stable setter (a useState dispatcher) — it's an effect dependency.
  onPointsChange: (v: string) => void;
  // Optional: reports {minutes, effortIndex, source} on every change. Must be stable (effect dep).
  onBuilderChange?: (info: BuilderEstimate) => void;
  // Optional seed for editing: preselect a builder value's duration/effort so it shows as chosen and
  // is reported as "builder". The initial auto-write is skipped, so seeding never clobbers the parent's
  // existing % (e.g. a manually-overridden one — don't seed those).
  initialMinutes?: number;
  initialEffortIndex?: number;
}

// The Points (%) field plus its assistive Duration + Effort controls. Points is the single source of
// truth owned by the parent form; picking a duration/effort writes a suggested % into it via the live
// conversion formula (Settings.pointsFormula — rate + effort presets). The duration/effort selections
// are local throwaway state — to clear them, remount with a changing `key`.
export default function PointsBuilder({ points, onPointsChange, onBuilderChange, initialMinutes, initialEffortIndex }: PointsBuilderProps) {
  const { settings } = useBoardClock();
  const formula = settings.pointsFormula;
  const [calcMins, setCalcMins] = useState<number | null>(initialMinutes ?? null);
  const seed = seedCustom(initialMinutes);
  const [calcUnit, setCalcUnit] = useState<"h" | "m">(seed.unit);
  const [customDur, setCustomDur] = useState(seed.text);
  const [effortIndex, setEffortIndex] = useState(initialEffortIndex ?? 0);

  // Write the suggested % whenever a duration/effort is chosen (or the formula changes under them).
  // Skips the first run so a seeded (edit) builder doesn't overwrite the parent's existing % on mount.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    if (calcMins !== null) {
      onPointsChange(String(pointsFromMinutes(calcMins, effortMultOf(formula, effortIndex), formula) / 1000));
    }
  }, [calcMins, effortIndex, formula, onPointsChange]);

  // Report source: "builder" when the current % equals the picked duration+effort's output at the live
  // formula, else "manual" (a hand-typed %, or no duration). Separate effect so writing points above
  // and reading it here don't loop.
  useEffect(() => {
    if (!onBuilderChange) return;
    const source =
      calcMins !== null &&
      parsePercent(points) === pointsFromMinutes(calcMins, effortMultOf(formula, effortIndex), formula)
        ? "builder"
        : "manual";
    onBuilderChange({ minutes: calcMins === null ? null : Math.round(calcMins), effortIndex, source });
  }, [points, calcMins, effortIndex, formula, onBuilderChange]);

  return (
    <>
      <label className="field">
        <span className="field-label">Points (%)</span>
        <input
          type="number"
          value={points}
          onChange={(e) => onPointsChange(e.target.value)}
          min="0"
          step="any"
          placeholder="0"
          required
        />
      </label>
      <div className="field">
        <span className="field-label">Duration</span>
        <div className="calc-pills">
          {DURATION_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`calc-pill${calcMins === p.minutes ? " active" : ""}`}
              onClick={() => setCalcMins(calcMins === p.minutes ? null : p.minutes)}
            >
              {p.label}
            </button>
          ))}
          <label className="calc-custom-wrap">
            <input
              type="number"
              className="calc-custom-mins"
              min={calcUnit === "h" ? "0.1" : "2"}
              step="any"
              placeholder="0"
              value={customDur}
              onChange={(e) => {
                setCustomDur(e.target.value);
                const mins = calcUnit === "h" ? Number(e.target.value) * 60 : Number(e.target.value);
                if (mins >= 2) setCalcMins(mins);
              }}
            />
            <button
              type="button"
              className="calc-custom-unit"
              aria-label={`Switch unit (currently ${calcUnit === "h" ? "hours" : "minutes"})`}
              onClick={() => {
                const next = calcUnit === "h" ? "m" : "h";
                setCalcUnit(next);
                const mins = next === "h" ? Number(customDur) * 60 : Number(customDur);
                if (mins >= 2) setCalcMins(mins);
              }}
            >
              {calcUnit}
            </button>
          </label>
        </div>
      </div>
      <div className="field">
        <span className="field-label">Effort</span>
        <div className="calc-pills">
          {formula.effortLevels.map((e, i) => (
            <button
              key={e.label}
              type="button"
              className={`calc-pill${effortIndex === i ? " active" : ""}`}
              onClick={() => setEffortIndex(i)}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>
    </>
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
  initialEffortIndex?: number;
}

// One tier's builder — the same PointsBuilder (Points % + Duration + Effort) a checkbox task gets, under
// a "Tier N" head — shared by the add and edit forms. Its own component so its callbacks are stable per
// row (the builder treats them as effect dependencies) and each tier's duration/effort stays its own.
export function TierBuilderRow({
  row,
  index,
  onPointsChange,
  onEstimateChange,
  onRemove,
  canRemove = true,
  initialMinutes,
  initialEffortIndex,
}: TierBuilderRowProps) {
  const handlePoints = useCallback((v: string) => onPointsChange(row.id, v), [row.id, onPointsChange]);
  const handleBuilder = useCallback((est: BuilderEstimate) => onEstimateChange(row.id, est), [row.id, onEstimateChange]);
  return (
    <div className="tier-builder-row">
      <div className="tier-builder-head">
        <span className="tier-row-label">Tier {index + 1}</span>
        {onRemove && (
          <button type="button" className="icon-btn" aria-label="Remove tier" onClick={() => onRemove(row.id)} disabled={!canRemove}>
            ✕
          </button>
        )}
      </div>
      <PointsBuilder
        points={row.points}
        onPointsChange={handlePoints}
        onBuilderChange={handleBuilder}
        initialMinutes={initialMinutes}
        initialEffortIndex={initialEffortIndex}
      />
    </div>
  );
}
