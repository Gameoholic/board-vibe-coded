import { useEffect, useRef } from "react";
import { statusLabel } from "./taskStatus";
import Tooltip from "./Tooltip";
import { daysSince, statusOf, waitDays, willFreezeAtWeekEnd } from "./types";
import type { Task } from "./types";
import { useBoardClock } from "./useBoardClock";

// A task's age beside its name: the days it has waited ("today", "5d", then "2w", then "3m") — on ice, in the Backlog
// and while Blocked; In progress pauses it. Its hover says when it was made, when it froze (or thawed), how
// long it's been in its status, and — before a week close that would freeze it — that it will.

const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** Days as the chip shows them: today, days under a week, weeks up to a month, months after. */
function ageLabel(days: number): string {
  if (days === 0) return "today";
  if (days < 7) return `${days}d`;
  if (days <= 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}m`;
}

interface AgeChipProps {
  task: Task;
  onIce: boolean;
  // Whether its tab has a Freezer — so a week close may freeze it.
  freezes: boolean;
}

export default function AgeChip({ task, onIce, freezes }: AgeChipProps) {
  const { now, settings } = useBoardClock();
  // The row's hover pill (Status) sits over the end of the name's line — where this chip can be. The pill wins
  // where the two overlap (its buttons are what you click); over the rest of the chip the row is told
  // (`age-peek`), the pill steps aside and the chip's details show. Measured on the row's pointer moves, since
  // the pill is on top.
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const chip = ref.current;
    const row = chip?.closest<HTMLElement>(".item-row");
    if (!chip || !row) return;
    const peek = (on: boolean) => {
      row.classList.toggle("age-peek", on);
      chip.classList.toggle("peek", on);
    };
    const over = (el: Element | null, e: PointerEvent) => {
      const r = el?.getBoundingClientRect();
      return !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    };
    const onMove = (e: PointerEvent) => peek(over(chip, e) && !over(row.querySelector(":scope > .status-pill"), e));
    const onLeave = () => peek(false);
    row.addEventListener("pointermove", onMove);
    row.addEventListener("pointerleave", onLeave);
    return () => {
      row.removeEventListener("pointermove", onMove);
      row.removeEventListener("pointerleave", onLeave);
      peek(false);
    };
  }, []);
  const ago = (iso: string) => {
    const days = daysSince(iso, now);
    return days === 0 ? "today" : `${plural(days)} ago`;
  };
  const lines = [`Created ${ago(task.createdAt)}`];
  if (task.tabSince) lines.push(`${onIce ? "Frozen" : "Thawed"} ${ago(task.tabSince)}`);
  if (!onIce) {
    const inStatus = daysSince(task.statusSince ?? task.tabSince ?? task.createdAt, now);
    lines.push(`${statusLabel(statusOf(task))} · ${inStatus === 0 ? "today" : plural(inStatus)}`);
  }
  const soon = freezes && willFreezeAtWeekEnd(task, now, settings);
  return (
    <span ref={ref} className="age-chip-spot">
    <Tooltip
      className={`age-chip${soon ? " soon" : ""}${onIce ? " on-ice" : ""}`}
      position="bottom"
      label={
        <>
          {lines.map((line) => (
            <span key={line} className="tooltip-line">
              {line}
            </span>
          ))}
          {soon && <span className="tooltip-line warn">Will freeze when week ends</span>}
        </>
      }
    >
      {ageLabel(waitDays(task, now))}
    </Tooltip>
    </span>
  );
}
