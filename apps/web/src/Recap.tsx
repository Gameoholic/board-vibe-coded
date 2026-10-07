import { formatPercent } from "@board/contracts";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState, type CSSProperties } from "react";
import { BoosterDeal } from "./BoosterDeal";
import { BountyRolls } from "./BountyRoll";
import { FlameIcon, SnowflakeIcon } from "./Icons";
import Tooltip from "./Tooltip";
import { tabInk } from "./palette";
import { dayLabel, labelFor } from "./periodLabels";
import type { BoosterHand, BountyStatus, BountyStopped, PeriodRecap, RecapDay, RecapFrost, RecapFrozen, RecapStreak, RecapTab } from "./types";

// The recap of a just-closed period, like a mobile game's daily log-in: a week opens on its days, each with
// what you cleared in every tab (in the tab's colour, with the % it earned), what the day earned and lost,
// and each purchase; then its streaks from the week's start to its end; then the frost its close banked and
// the tasks it froze; then the next week's Bounty reel to swing, and its Booster hand to pick from. Pages you
// flip, so nothing scrolls.
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

// What the recap's last pages do on the board: roll a Bounty on the spot the week's reel stopped on and reroll
// one (see BountyRolls), and take a card of its Booster hand — the hand with it turned over, or null when the
// server refused.
interface RecapActions {
  onRollBounty: (spot: number) => Promise<BountyStopped | null>;
  onRerollBounty: (taskId: string) => Promise<BountyStatus | null>;
  onPickBooster: (card: number) => Promise<BoosterHand | null>;
}

interface PeriodRecapCardProps extends RecapActions {
  recap: PeriodRecap;
  onClose: () => void;
}

export function PeriodRecapCard({ recap, onClose, ...actions }: PeriodRecapCardProps) {
  if (recap.kind === "week") return <NoteWall recap={recap} onClose={onClose} {...actions} />;
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
        <RecapBody recap={recap} onDone={onClose} {...actions} />
      </motion.div>
    </div>
  );
}

// The week's recap: the board fades back behind a frosted wash and the week is stuck onto it as notes
// (App holds the board's new week until it's closed, so nothing is given away early). Done peels the notes
// off and drops them, then it closes and the wash clears.
function NoteWall({ recap, onClose, ...actions }: PeriodRecapCardProps) {
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
        <RecapBody recap={recap} onDone={leave} {...actions} />
      </motion.div>
    </div>
  );
}

// The recap itself, the same in the card and on the wall: its date, the page you're on, and the way through.
// The Bounty's page holds the way on back until its reels have landed, and the Booster's until its pick has,
// so neither is passed by.
function RecapBody({ recap, onRollBounty, onRerollBounty, onPickBooster, onDone }: RecapActions & { recap: PeriodRecap; onDone: () => void }) {
  // How many Bounties the week has as the page is shown: those rolled, and the stops its reel has left.
  const bounties = (recap.bounty?.bounties.length ?? 0) + (recap.bounty?.reel?.rolls ?? 0);
  const pages: Page[] =
    recap.kind === "week"
      ? [
          { key: "days", label: "Your week" },
          ...(recap.streaks.length > 0 ? [{ key: "streaks", label: "Streaks" }] : []),
          ...(recap.frost.length > 0 ? [{ key: "frost", label: "Frost" }] : []),
          ...(recap.frozen.length > 0 ? [{ key: "frozen", label: "Frozen" }] : []),
          ...(bounties > 0 || recap.bountyEmpty ? [{ key: "bounty", label: bounties > 1 ? "Bounties" : "Bounty" }] : []),
          ...(recap.booster ? [{ key: "booster", label: recap.booster.picks > 1 ? "Boosters" : "Booster" }] : []),
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
  const [bountyLanded, setBountyLanded] = useState(!recap.bounty?.reel);
  const [boosterLanded, setBoosterLanded] = useState(false);
  const waiting = (current.key === "bounty" && !bountyLanded) || (current.key === "booster" && !boosterLanded);

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
            {current.key === "frost" && <FrostPage frost={recap.frost} />}
            {current.key === "frozen" && <FrozenPage frozen={recap.frozen} />}
            {current.key === "bounty" &&
              (recap.bounty && bounties > 0 ? (
                <BountiesPage status={recap.bounty} onRoll={onRollBounty} onReroll={onRerollBounty} onLandedChange={setBountyLanded} />
              ) : (
                <NoBountyPage />
              ))}
            {current.key === "booster" && recap.booster && (
              <BoosterPage hand={recap.booster} onPick={onPickBooster} onLanded={() => setBoosterLanded(true)} />
            )}
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
            <button type="button" className="btn-primary" disabled={waiting} onClick={onDone}>
              Done
            </button>
          ) : (
            <button type="button" className="btn-primary" disabled={waiting} onClick={() => go(page + 1)}>
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
    // Unnamed, it's only a number in the tab's colour — its tooltip says whose.
    <Tooltip className="recap-tab" label={named ? undefined : `${tab.name}: ${tab.cleared} cleared`}>
      {named && <span className="recap-tab-name">{tab.name}</span>}
      <b style={{ color: tabInk(tab.color) }}>{tab.cleared}</b>
      <span className="recap-tab-pct">({formatPercent(tab.earned)})</span>
    </Tooltip>
  );
}

function Purchases({ day }: { day: RecapDay }) {
  return day.purchases.length > 0 ? (
    <ul className="recap-purchases">
      {day.purchases.map((p, i) => (
        <li key={i}>
          {/* The name is cut short where it doesn't fit; its tooltip has all of it. */}
          <Tooltip className="recap-purchase" label={p.name} align="start">
            <span className="recap-purchase-name">
              {p.emoji} {p.name}
            </span>
            <span className="lost">−{formatPercent(p.cost)}</span>
          </Tooltip>
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
              <i style={{ background: tabInk(tab.color) }} />
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
              <i style={{ background: tabInk(tab.color) }} />
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

// The frost the week's close banked, on one ice-blue note: each task's frost from what it was to what it is
// (what it adds to its points), its bar filling up — and a task whose frost just filled gets Subzero stamped on.
function FrostPage({ frost }: { frost: RecapFrost[] }) {
  return (
    <motion.ul className="recap-frost recap-note recap-drop" style={dropStyle(2)} {...slap(2)}>
      {frost.map((f, i) => (
        <motion.li key={f.taskId} {...pop(i + 2)}>
          <SnowflakeIcon size={13} />
          <span className="recap-frost-name">{f.name}</span>
          <span className="recap-frost-run">
            +{formatPercent(f.from)} → <b>+{formatPercent(f.to)}</b>
          </span>
          <span className="recap-frost-bar" aria-hidden="true">
            <motion.i
              initial={{ width: `${f.fillFrom * 100}%` }}
              animate={{ width: `${f.fillTo * 100}%` }}
              transition={{ delay: 0.55 + i * SPAWN_STEP, duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
            />
          </span>
          {f.subzero && (
            <motion.span
              className="recap-subzero"
              initial={f.subzeroNow ? { opacity: 0, scale: 2.6, rotate: -16 } : false}
              animate={{ opacity: 1, scale: 1, rotate: -5 }}
              transition={{ delay: 1.4 + i * SPAWN_STEP, type: "spring", stiffness: 420, damping: 14 }}
            >
              Subzero
            </motion.span>
          )}
        </motion.li>
      ))}
    </motion.ul>
  );
}

// The tasks the week's close froze, each a note that frosts over as it lands, with how long it had waited.
function FrozenPage({ frozen }: { frozen: RecapFrozen[] }) {
  return (
    <ol className="recap-frozen">
      {frozen.map((f, i) => (
        <motion.li key={f.taskId} className="recap-frozen-note recap-note recap-drop" style={dropStyle(i)} {...slap(i)}>
          <span className="recap-frozen-name">{f.name}</span>
          <span className="recap-frozen-waited">
            <SnowflakeIcon size={13} />
            Waited {f.waited} {f.waited === 1 ? "day" : "days"}
          </span>
        </motion.li>
      ))}
    </ol>
  );
}

// Bounties are on, but nothing was on ice to roll.
function NoBountyPage() {
  return (
    <motion.div className="recap-no-bounty recap-note recap-drop" style={dropStyle(1)} {...slap(1)}>
      <SnowflakeIcon size={18} />
      <p>Nothing's on ice, so there's no Bounty this week.</p>
    </motion.div>
  );
}

// The new week's Booster hand, dealt for you to pick from.
function BoosterPage({ hand, onPick, onLanded }: { hand: BoosterHand; onPick: (card: number) => Promise<BoosterHand | null>; onLanded: () => void }) {
  return (
    <div className="booster-page">
      <div className="booster-page-head">{hand.picks > 1 ? "This week's Boosters" : "This week's Booster"}</div>
      <div className="recap-drop" style={dropStyle(0)}>
        <BoosterDeal hand={hand} onPick={onPick} onLanded={onLanded} />
      </div>
    </div>
  );
}

// The new week's Bounties, each on its own reel to swing, then what a Bounty means.
function BountiesPage({
  status,
  onRoll,
  onReroll,
  onLandedChange,
}: {
  status: BountyStatus;
  onRoll: (spot: number) => Promise<BountyStopped | null>;
  onReroll: (taskId: string) => Promise<BountyStatus | null>;
  onLandedChange: (landed: boolean) => void;
}) {
  const several = status.bounties.length + (status.reel?.rolls ?? 0) > 1;
  return (
    <div className="bounty-page">
      <div className="bounty-page-head">{several ? "This week's Bounties" : "This week's Bounty"}</div>
      <BountyRolls status={status} onRoll={onRoll} onReroll={onReroll} onLandedChange={onLandedChange} slotClassName="recap-drop" slotStyle={dropStyle} />
    </div>
  );
}
