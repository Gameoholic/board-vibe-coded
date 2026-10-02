import { formatPercent } from "@board/contracts";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState, type CSSProperties } from "react";
import { BountyExplain, BountyRoll } from "./BountyRoll";
import { FlameIcon } from "./Icons";
import { dayLabel, labelFor } from "./periodLabels";
import type { PeriodRecap, RecapDay, RecapStreak, RecapTab, RolledBounty } from "./types";

// The recap of a just-closed period, like a mobile game's daily log-in: a week opens on its days, each with
// what you cleared in every tab (in the tab's colour, with the % it earned), what the day earned and lost,
// and each purchase; then its streaks from the week's start to its end; then the next week's Bounty roll.
// Pages you flip, so nothing scrolls.
// A week's takes over the screen as sticky notes on the board (NoteWall); a day's is a floating card over a
// soft (never fully dark) scrim, in keeping with the no-heavy-modal rule.

// How far apart the days (and a day's lines) pop in, in seconds.
const SPAWN_STEP = 0.12;
// How long the notes take to peel off and fall when the week's recap is done, before it closes (ms).
const PEEL_MS = 1050;
// Each note's tilt, by its place — fixed, so a render is pure and a note never changes its lean.
const TILTS = [-3, 2, -1.5, 3, -2.5, 1.5, -1, 2.5];
const tiltOf = (i: number) => TILTS[i % TILTS.length];

const signed = (points: number) => `${points >= 0 ? "+" : ""}${formatPercent(points)}`;
const pop = (i: number) => ({
  initial: { opacity: 0, scale: 0.7, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  transition: { delay: 0.1 + i * SPAWN_STEP, type: "spring" as const, stiffness: 420, damping: 22 },
});
// A sticky note slapped onto the board: in from above, bigger and leaning harder, landing at its tilt.
const slap = (i: number) => ({
  initial: { opacity: 0, scale: 1.35, y: -36, rotate: tiltOf(i) * 3 },
  animate: { opacity: 1, scale: 1, y: 0, rotate: tiltOf(i) },
  transition: { delay: 0.2 + i * SPAWN_STEP, type: "spring" as const, stiffness: 520, damping: 20 },
});
// What a note needs to fall when the recap's done (App.css .recap-drop): its tilt, its place in the fall,
// and which way it drifts.
const dropStyle = (i: number): CSSProperties =>
  ({ "--r": `${tiltOf(i)}deg`, "--i": i, "--drift": `${tiltOf(i) * 30}px` }) as CSSProperties;

type Page = { key: string; label: string };

interface PeriodRecapCardProps {
  recap: PeriodRecap;
  onReroll: (taskId: string) => void;
  onClose: () => void;
}

export function PeriodRecapCard({ recap, onReroll, onClose }: PeriodRecapCardProps) {
  if (recap.kind === "week") return <NoteWall recap={recap} onReroll={onReroll} onClose={onClose} />;
  return (
    <div className="recap-scrim" onClick={onClose}>
      <motion.div
        className="recap-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
      >
        <RecapBody recap={recap} onReroll={onReroll} onDone={onClose} />
      </motion.div>
    </div>
  );
}

// The week's recap: the board fades back behind a frosted wash and the week is stuck onto it as notes
// (App holds the board's new week until it's closed, so nothing is given away early). Done peels the notes
// off and drops them, then it closes and the wash clears.
function NoteWall({ recap, onReroll, onClose }: PeriodRecapCardProps) {
  const reduce = useReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const leave = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(onClose, reduce ? 0 : PEEL_MS);
  };
  return (
    <div className={`recap-wall${leaving ? " leaving" : ""}`} role="dialog" aria-modal="true" aria-label="Week recap">
      <motion.div className="recap-wash" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} />
      <motion.div className="recap-screen" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.15 }}>
        <RecapBody recap={recap} onReroll={onReroll} onDone={leave} />
      </motion.div>
    </div>
  );
}

// The recap itself, the same in the card and on the wall: its date, the page you're on, and the way through.
function RecapBody({ recap, onReroll, onDone }: { recap: PeriodRecap; onReroll: (taskId: string) => void; onDone: () => void }) {
  const pages: Page[] =
    recap.kind === "week"
      ? [
          { key: "days", label: "Your week" },
          ...(recap.streaks.length > 0 ? [{ key: "streaks", label: "Streaks" }] : []),
          ...(recap.bounties.length > 0 ? [{ key: "bounty", label: recap.bounties.length > 1 ? "Bounties" : "Bounty" }] : []),
        ]
      : [{ key: "day", label: "Your day" }];
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState(1);
  const go = (to: number) => {
    setDirection(to > page ? 1 : -1);
    setPage(to);
  };
  const current = pages[page];
  const last = page === pages.length - 1;

  return (
    <>
      <div className="recap-head">
        <span className="recap-kicker">{recap.kind === "week" ? "Week" : "Day"} recap</span>
        <span className="recap-date">{labelFor(recap.kind, recap.periodKey)}</span>
      </div>

      <div className="recap-pages">
        {/* No initial={false}: it would also hold back the first page's own pop-ins (the days). */}
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={current.key}
            className="recap-page"
            custom={direction}
            initial={{ opacity: 0, x: 40 * direction }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 * direction }}
            transition={{ duration: 0.18 }}
          >
            {current.key === "day" && <DayPage day={recap.days[0]} />}
            {current.key === "days" && <WeekDaysPage recap={recap} />}
            {current.key === "streaks" && <StreaksPage streaks={recap.streaks} />}
            {current.key === "bounty" && <BountiesPage bounties={recap.bounties} onReroll={onReroll} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="recap-foot">
        {pages.length > 1 && (
          <div className="recap-dots">
            {pages.map((p, i) => (
              <button
                key={p.key}
                type="button"
                className={i === page ? "on" : undefined}
                aria-label={p.label}
                aria-current={i === page ? "step" : undefined}
                onClick={() => go(i)}
              />
            ))}
          </div>
        )}
        <div className="recap-nav">
          {page > 0 && (
            <button type="button" className="ghost-btn" onClick={() => go(page - 1)}>
              Back
            </button>
          )}
          {last ? (
            <button type="button" className="btn-primary" onClick={onDone}>
              Done
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={() => go(page + 1)}>
              Next
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// One tab's line on a day: how many it cleared, in the tab's colour, and the % that earned.
function TabCount({ tab, named = false }: { tab: RecapTab; named?: boolean }) {
  return (
    <span className="recap-tab" title={`${tab.name}: ${tab.cleared} cleared`}>
      {named && <span className="recap-tab-name">{tab.name}</span>}
      <b style={{ color: tab.color }}>{tab.cleared}</b>
      <span className="recap-tab-pct">({formatPercent(tab.earned)})</span>
    </span>
  );
}

function Purchases({ day }: { day: RecapDay }) {
  return day.purchases.length > 0 ? (
    <ul className="recap-purchases">
      {day.purchases.map((p, i) => (
        <li key={i} title={p.name}>
          <span className="recap-purchase-name">
            {p.emoji} {p.name}
          </span>
          <span className="lost">−{formatPercent(p.cost)}</span>
        </li>
      ))}
    </ul>
  ) : null;
}

// A day's recap: each tab it cleared something in (named, in its colour), then what it earned and lost,
// and each purchase — popping in line by line.
function DayPage({ day }: { day: RecapDay }) {
  return (
    <div className="recap-day-page">
      {day.tabs.length === 0 ? (
        <motion.p className="recap-empty" {...pop(0)}>
          Nothing cleared this day.
        </motion.p>
      ) : (
        <ul className="recap-day-tabs">
          {day.tabs.map((tab, i) => (
            <motion.li key={tab.sectionId} {...pop(i)}>
              <i style={{ background: tab.color }} />
              <TabCount tab={tab} named />
            </motion.li>
          ))}
        </ul>
      )}
      <motion.dl className="recap-sums" {...pop(day.tabs.length + 1)}>
        <div className="recap-sum">
          <dt>Earned</dt>
          <dd>{signed(day.earned)}</dd>
        </div>
        <div className="recap-sum lost">
          <dt>Lost</dt>
          <dd>{day.lost > 0 ? `−${formatPercent(day.lost)}` : formatPercent(0)}</dd>
        </div>
      </motion.dl>
      <motion.div {...pop(day.tabs.length + 2)}>
        <Purchases day={day} />
      </motion.div>
    </div>
  );
}

// A day's note takes the colour of the tab it cleared most in, washed out like a sticky note's paper.
function noteColor(day: RecapDay): string | undefined {
  const most = day.tabs.reduce<RecapTab | undefined>((a, b) => (!a || b.cleared > a.cleared ? b : a), undefined);
  return most ? `color-mix(in srgb, ${most.color} 22%, #fff)` : undefined;
}

// A week's days slapped on one after another as sticky notes, then the week's total. Which colour is which
// tab is said once, above them.
function WeekDaysPage({ recap }: { recap: PeriodRecap }) {
  const legend = new Map<string, RecapTab>();
  for (const day of recap.days) for (const tab of day.tabs) if (!legend.has(tab.sectionId)) legend.set(tab.sectionId, tab);
  return (
    <div className="recap-week">
      {legend.size > 0 && (
        <div className="recap-legend">
          {[...legend.values()].map((tab) => (
            <span key={tab.sectionId}>
              <i style={{ background: tab.color }} />
              {tab.name}
            </span>
          ))}
        </div>
      )}
      <ol className="recap-days">
        {recap.days.map((day, i) => {
          const { weekday, date } = dayLabel(day.dayKey);
          const empty = day.tabs.length === 0 && day.purchases.length === 0;
          return (
            <motion.li
              key={day.dayKey}
              className={`recap-day recap-note recap-drop${empty ? " empty" : ""}`}
              style={{ ...dropStyle(i), background: noteColor(day) }}
              {...slap(i)}
            >
              <span className="recap-day-label">
                {weekday} <b>{date}</b>
              </span>
              <span className="recap-day-counts">
                {day.tabs.map((tab) => (
                  <TabCount key={tab.sectionId} tab={tab} />
                ))}
                {empty && <span className="recap-day-none">—</span>}
              </span>
              {!empty && (
                <span className="recap-day-sums">
                  <span>{signed(day.earned)}</span>
                  {day.lost > 0 && <span className="lost">−{formatPercent(day.lost)}</span>}
                </span>
              )}
              <Purchases day={day} />
            </motion.li>
          );
        })}
        <motion.li className="recap-day recap-note recap-drop recap-week-total" style={dropStyle(recap.days.length)} {...slap(recap.days.length)}>
          <span className="recap-day-label">Week</span>
          <span className="recap-day-sums">
            <span>{signed(recap.earned)}</span>
            {recap.lost > 0 && <span className="lost">−{formatPercent(recap.lost)}</span>}
          </span>
        </motion.li>
      </ol>
    </div>
  );
}

// Each streak from where it stood as the week began to where it ends it — all on one note.
function StreaksPage({ streaks }: { streaks: RecapStreak[] }) {
  return (
    <motion.ul className="recap-streaks recap-note recap-drop" style={dropStyle(2)} {...slap(2)}>
      {streaks.map((st, i) => {
        const delta = st.start === null ? null : st.end - st.start;
        return (
          <motion.li key={st.streakId} {...pop(i + 2)}>
            <FlameIcon size={13} />
            <span className="recap-streak-name">{st.name}</span>
            <span className="recap-streak-run">
              {st.start ?? "–"} → <b>{st.end}</b>
            </span>
            <span className={`recap-streak-delta${delta === null ? "" : delta > 0 ? " up" : delta < 0 ? " down" : ""}`}>
              {delta === null ? "new" : delta === 0 ? "" : delta > 0 ? `+${delta}` : `${delta}`}
            </span>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}

// The new week's Bounties, each on its own reel — one after another, each spinning once the last has
// landed — then what a Bounty means.
function BountiesPage({ bounties, onReroll }: { bounties: RolledBounty[]; onReroll: (taskId: string) => void }) {
  const [landed, setLanded] = useState(0);
  return (
    <div className="bounty-page">
      <div className="bounty-page-head">{bounties.length > 1 ? "This week's Bounties" : "This week's Bounty"}</div>
      {bounties.map((bounty, i) => (
        // Keyed by the task it landed on, so a reroll spins the reel again.
        <div key={bounty.taskId} className="recap-drop" style={dropStyle(i)}>
          <BountyRoll
            bounty={bounty}
            spin={i <= landed}
            onLanded={() => setLanded((n) => Math.max(n, i + 1))}
            onReroll={() => onReroll(bounty.taskId)}
          />
        </div>
      ))}
      <div className="recap-drop" style={dropStyle(bounties.length)}>
        <BountyExplain multiplier={bounties[0].multiplier} several={bounties.length > 1} shown={landed >= bounties.length} />
      </div>
    </div>
  );
}
