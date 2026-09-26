import type { BoxSchedule } from "./types";

// Per-box "do this at a certain hour" schedule editor, duck-typed onto any checkbox task (see
// Task.schedule / isBoxLocked). Shared by the add-task and edit-task forms so they're identical by
// construction. The cadence is NOT chosen here — it's inferred from the section's `period` and passed
// in, so daily/weekly is read off the tab, never a per-task option:
//   • daily  — each box takes a time; it unlocks at that time every day (no weekday).
//   • weekly — each box takes a weekday, and optionally a time; blank time means "any time that day".
// A box left blank (no time in daily, no weekday in weekly) is unscheduled / always open.

export type Cadence = "daily" | "weekly";

// day: "" = none (box unscheduled in weekly mode), else "0".."6" (Sun..Sat).
export interface ScheduleRow {
  time: string;
  day: string;
}

const EMPTY_ROW: ScheduleRow = { time: "", day: "" };

const WEEKDAYS: { value: string; label: string }[] = [
  { value: "", label: "—" },
  { value: "0", label: "Sun" },
  { value: "1", label: "Mon" },
  { value: "2", label: "Tue" },
  { value: "3", label: "Wed" },
  { value: "4", label: "Thu" },
  { value: "5", label: "Fri" },
  { value: "6", label: "Sat" },
];

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const minutesOf = (time: string): number | undefined => {
  if (!time) return undefined;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

/** Build editor rows for `count` boxes from a stored schedule (missing/short entries → blank rows). */
export function rowsFromSchedule(schedule: (BoxSchedule | null)[] | undefined, count: number): ScheduleRow[] {
  return Array.from({ length: count }, (_, i) => {
    const e = schedule?.[i];
    if (!e) return { ...EMPTY_ROW };
    return {
      time: e.minutes !== undefined ? hhmm(e.minutes) : "",
      day: e.dayOfWeek !== undefined ? String(e.dayOfWeek) : "",
    };
  });
}

/** Convert rows to a schedule array for the given cadence (daily = time-only; weekly = weekday + time?). */
export function scheduleFromRows(rows: ScheduleRow[], cadence: Cadence, count: number): (BoxSchedule | null)[] {
  return Array.from({ length: count }, (_, i) => {
    const r = rows[i] ?? EMPTY_ROW;
    const minutes = minutesOf(r.time);
    if (cadence === "daily") return minutes === undefined ? null : { minutes };
    if (r.day === "") return null; // weekly: a box needs a weekday to be scheduled
    return minutes === undefined ? { dayOfWeek: Number(r.day) } : { dayOfWeek: Number(r.day), minutes };
  });
}

interface ScheduleEditorProps {
  count: number;
  cadence: Cadence;
  rows: ScheduleRow[];
  onChange: (rows: ScheduleRow[]) => void;
}

export default function ScheduleEditor({ count, cadence, rows, onChange }: ScheduleEditorProps) {
  function setRow(i: number, patch: Partial<ScheduleRow>) {
    const next = Array.from({ length: count }, (_, j) => rows[j] ?? { ...EMPTY_ROW });
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }

  const weekly = cadence === "weekly";

  return (
    <div className="field">
      <span className="field-label">Scheduled times (optional)</span>
      <div className="schedule-rows">
        {Array.from({ length: count }, (_, i) => {
          const row = rows[i] ?? EMPTY_ROW;
          return (
            <div key={i} className="schedule-row">
              {count > 1 && <span className="schedule-box-label">#{i + 1}</span>}
              {weekly && (
                <select
                  className="schedule-day"
                  value={row.day}
                  onChange={(e) => setRow(i, { day: e.target.value })}
                >
                  {WEEKDAYS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
              <input
                type="time"
                className="schedule-time"
                value={row.time}
                // Weekly time is optional and only meaningful once a weekday is picked.
                placeholder={weekly ? "Any time" : undefined}
                disabled={weekly && row.day === ""}
                onChange={(e) => setRow(i, { time: e.target.value })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
