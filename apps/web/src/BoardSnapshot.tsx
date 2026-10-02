import { useLayoutEffect, useRef, useState } from "react";
import { placeCards } from "./canvas";
import { listedByDefault } from "./listOps";
import { behaviorOf } from "./types";
import type { Section, StreakView, Task } from "./types";
import type { CardLayout } from "./useLocalConfig";

// A still picture of a board, drawn small to fit (a backup's preview): its tabs where this device keeps
// them, each listing what it held — the tasks still on it, ticked or not, and its streaks. Only the gist
// of the live card: nothing in it is interactive, and a row is just its boxes and its words.

interface BoardSnapshotProps {
  sections: Section[];
  tasks: Task[];
  streaks: StreakView[];
  layouts: Record<string, CardLayout>;
  // The room it may take, in screen px; it keeps the board's proportions inside.
  width: number;
  height: number;
}

// A row draws at most this many boxes — enough to read a tiered task's progress at a glance.
const MAX_BOXES = 5;

function SnapshotTask({ task }: { task: Task }) {
  const b = behaviorOf(task);
  const filled = b.filled(task);
  // A counter is one box holding its count; the rest draw their boxes, ticked up to the filled level.
  const boxes = b.renderKind(task) === "counter" ? 1 : Math.min(b.boxes(task), MAX_BOXES);
  return (
    <li className={b.isDone(task) ? "snapshot-row done" : "snapshot-row"}>
      <span className="snapshot-boxes">
        {Array.from({ length: boxes }, (_, i) => (
          <i key={i} className={i < filled ? "on" : undefined} />
        ))}
      </span>
      <span className="snapshot-text">{task.text}</span>
    </li>
  );
}

export default function BoardSnapshot({ sections, tasks, streaks, layouts, width, height }: BoardSnapshotProps) {
  const placed = placeCards(sections, layouts);
  const left = Math.min(...sections.map((s) => placed[s.id].x));
  const top = Math.min(...sections.map((s) => placed[s.id].y));
  const worldRef = useRef<HTMLDivElement>(null);
  // The world's drawn size, measured once drawn: a card grows past its set height to fit its rows, as on
  // the board, so only the drawing knows how far down it reaches.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const cards = Array.from(worldRef.current?.children ?? []) as HTMLElement[];
    setSize({
      w: Math.max(1, ...cards.map((c) => c.offsetLeft + c.offsetWidth)),
      h: Math.max(1, ...cards.map((c) => c.offsetTop + c.offsetHeight)),
    });
  }, [sections, tasks, streaks, layouts]);
  const scale = size ? Math.min(width / size.w, height / size.h, 1) : 0;

  if (sections.length === 0) return <p className="snapshot-empty">An empty board.</p>;
  return (
    <div className="snapshot" style={size ? { width: size.w * scale, height: size.h * scale } : { visibility: "hidden" }}>
      <div ref={worldRef} className="snapshot-world" style={{ transform: `scale(${scale})` }}>
        {sections.map((section) => {
          const at = placed[section.id];
          const rows = tasks.filter((t) => t.sectionId === section.id && listedByDefault(t));
          return (
            <div
              key={section.id}
              className="snapshot-card"
              style={{ left: at.x - left, top: at.y - top, width: at.w, minHeight: at.h, zIndex: at.z, "--task-color": section.color } as React.CSSProperties}
            >
              <div className="snapshot-title" style={{ color: section.color }}>
                {section.name}
              </div>
              <ul>
                {rows.map((task) => (
                  <SnapshotTask key={task.id} task={task} />
                ))}
                {streaks
                  .filter((s) => s.sectionId === section.id)
                  .map((streak) => (
                    <li key={streak.id} className="snapshot-row">
                      <span className="snapshot-text">{streak.name}</span>
                      <span className="snapshot-count">{streak.count}</span>
                    </li>
                  ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
