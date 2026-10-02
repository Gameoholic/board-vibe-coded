import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BackupList as BackupListSchema, BackupPreview as BackupPreviewSchema, formatPercent } from "@board/contracts";
import BoardSnapshot from "./BoardSnapshot";
import { listedByDefault } from "./listOps";
import { behaviorOf } from "./types";
import { useClickOutside } from "./useClickOutside";
import type { BackupList, BackupPreview, BackupSettings } from "./types";
import type { CardLayout } from "./useLocalConfig";

// Settings → Backups' list of saved backups, newest first. Hovering one (tapping, on touch) shows its board
// as it was saved, read from the backup itself.

interface BackupSlotsProps {
  settings: BackupSettings;
  timeZone: string;
  // The real clock (backups never follow the debug one), ticking each minute.
  realNow: string;
  layouts: Record<string, CardLayout>;
}

// The preview's most room, and how far it keeps from the slot and the window's edges (px).
const PREVIEW_W = 720;
const PREVIEW_H = 440;
const GAP = 8;
const EDGE = 16;
// The preview's head (the date and the counts) — the rest of its height is the board's.
const HEAD_H = 64;

interface Shown {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  up: boolean;
}

// Beside the slot: below it, or above where there's more room there; centred on it, kept on screen.
function placeBeside(name: string, slot: HTMLElement): Shown {
  const r = slot.getBoundingClientRect();
  const w = Math.min(PREVIEW_W, window.innerWidth - 2 * EDGE);
  const x = Math.min(Math.max(EDGE, r.left + r.width / 2 - w / 2), window.innerWidth - EDGE - w);
  const below = window.innerHeight - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  const up = below < PREVIEW_H && above > below;
  return { name, x, w, up, y: up ? r.top - GAP : r.bottom + GAP, h: Math.min(PREVIEW_H, up ? above : below) };
}

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const sinceLabel = (iso: string, now: string) => {
  const hours = Math.round((Date.parse(now) - Date.parse(iso)) / 3_600_000);
  const words = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (hours < 1) return "just now";
  return hours < 24 ? words.format(-hours, "hour") : words.format(-Math.round(hours / 24), "day");
};

export default function BackupSlots({ settings, timeZone, realNow, layouts }: BackupSlotsProps) {
  const [list, setList] = useState<BackupList | null>(null);
  const [previews, setPreviews] = useState<Record<string, BackupPreview | "unreadable">>({});
  const [shown, setShown] = useState<Shown | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useClickOutside(listRef, () => setShown(null), shown !== null);

  // Fetched again whenever the settings change — the server checks then, so a backup may just have been
  // taken, and the next one moves. Only the latest fetch lands.
  useEffect(() => {
    let live = true;
    fetch("/api/backups")
      .then((res) => res.json())
      .then((data) => live && setList(BackupListSchema.parse(data)));
    return () => {
      live = false;
    };
  }, [settings]);

  // A preview is pinned to its slot, so it goes the moment anything scrolls.
  useEffect(() => {
    if (!shown) return;
    const hide = () => setShown(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [shown]);

  function show(name: string, slot: HTMLElement) {
    setShown(placeBeside(name, slot));
    if (previews[name]) return;
    // A backup never changes, so each is read once.
    fetch(`/api/backups/${encodeURIComponent(name)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => setPreviews((prev) => ({ ...prev, [name]: BackupPreviewSchema.parse(data) })))
      .catch(() => setPreviews((prev) => ({ ...prev, [name]: "unreadable" })));
  }

  const when = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });

  if (!list) return null;
  const next = list.nextAt === null
    ? "Automatic backups are off."
    : list.nextAt <= realNow
      ? "Next backup in the next few minutes."
      : `Next backup around ${when(list.nextAt)}.`;
  const preview = shown ? previews[shown.name] : undefined;

  return (
    <div className="field">
      <span className="field-label">Saved backups</span>
      {list.slots.length === 0 ? (
        <span className="field-hint">No backups yet.</span>
      ) : (
        <ul className="backup-slots" ref={listRef}>
          {list.slots.map((slot, i) => (
            <li key={slot.name}>
              <button
                type="button"
                className={shown?.name === slot.name ? "backup-slot is-shown" : "backup-slot"}
                onPointerEnter={(e) => e.pointerType === "mouse" && show(slot.name, e.currentTarget)}
                onPointerLeave={(e) => e.pointerType === "mouse" && setShown(null)}
                // Touch and keys have no hover: a tap (or Enter) shows it, another hides it.
                onClick={(e) => {
                  if ((e.nativeEvent as PointerEvent).pointerType === "mouse") return;
                  if (shown?.name === slot.name) setShown(null);
                  else show(slot.name, e.currentTarget);
                }}
              >
                <span className="backup-slot-when">{when(slot.takenAt)}</span>
                <span className="backup-slot-since">{sinceLabel(slot.takenAt, realNow)}</span>
                {i >= settings.keep && <span className="backup-slot-drop">goes at the next backup</span>}
                <span className="backup-slot-size">{sizeLabel(slot.bytes)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="field-hint">{next}</span>
      {shown &&
        createPortal(
          <div
            className={shown.up ? "backup-preview up" : "backup-preview"}
            style={{ left: shown.x, top: shown.y, width: shown.w }}
            role="tooltip"
          >
            {preview === undefined ? (
              <p className="backup-preview-note">Opening the backup…</p>
            ) : preview === "unreadable" ? (
              <p className="backup-preview-note">Couldn't read this backup.</p>
            ) : (
              <>
                <div className="backup-preview-head">
                  <strong>{when(preview.takenAt)}</strong>
                  <span>{previewCounts(preview)}</span>
                </div>
                <BoardSnapshot
                  sections={preview.sections}
                  tasks={preview.tasks}
                  streaks={preview.streaks}
                  layouts={layouts}
                  width={shown.w - 2 * 14}
                  height={shown.h - HEAD_H}
                />
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

function previewCounts(preview: BackupPreview): string {
  const listed = preview.tasks.filter(listedByDefault);
  const ticked = listed.filter((t) => behaviorOf(t).isDone(t)).length;
  const tabs = preview.sections.length;
  return `${tabs} ${tabs === 1 ? "tab" : "tabs"} · ${ticked} of ${listed.length} tasks ticked · ${formatPercent(preview.points)} to spend`;
}
