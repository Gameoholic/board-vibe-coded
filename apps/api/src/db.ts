import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { BoardEvent, type StoredEvent } from "@board/contracts";

// The one persisted table: an append-only event log. Current state is never stored — it's folded
// from these rows on boot (see projection.ts). SQLite via Node's built-in driver keeps this a single
// file with zero native build; a real deploy can swap the driver behind this same interface.
// ponytail: node:sqlite instead of better-sqlite3 — no compiler needed. Same engine, near-identical
// sync API; swap to better-sqlite3 here alone once the deploy host has a C toolchain.

export interface AppendResult {
  stored: StoredEvent;
  /** false when an idempotency key matched an existing event, so the caller must not re-apply it. */
  created: boolean;
}

export interface EventStore {
  /** The resolved database file path (or ":memory:"). */
  readonly file: string;
  append(event: BoardEvent, occurredAt: string, idempotencyKey?: string | null): AppendResult;
  readAll(): StoredEvent[];
  /** Delete every event — the one destructive operation, used only by the "reset board" setting. */
  clear(): void;
  /** Write a consistent snapshot of the whole database to `target`, which must not exist yet. */
  backupTo(target: string): void;
}

interface EventRow {
  seq: number;
  id: string;
  payload: string;
  occurred_at: string;
  idempotency_key: string | null;
}

function defaultDbPath(): string {
  return fileURLToPath(new URL("../data/board.db", import.meta.url));
}

export function openEventStore(path: string = process.env.BOARD_DB ?? defaultDbPath()): EventStore {
  const file = path === ":memory:" ? path : resolve(path);
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      idempotency_key TEXT UNIQUE
    );
  `);

  const insert = db.prepare(
    "INSERT INTO events (id, type, payload, occurred_at, idempotency_key) VALUES (?, ?, ?, ?, ?)",
  );
  const selectByKey = db.prepare("SELECT * FROM events WHERE idempotency_key = ?");
  const selectAll = db.prepare("SELECT * FROM events ORDER BY seq ASC");

  function rowToStored(row: EventRow): StoredEvent {
    return {
      seq: row.seq,
      id: row.id,
      occurredAt: row.occurred_at,
      // Validate on read so a corrupted row fails loudly rather than silently poisoning the rebuild.
      event: BoardEvent.parse(JSON.parse(row.payload)),
      idempotencyKey: row.idempotency_key,
    };
  }

  return {
    file,
    append(event, occurredAt, idempotencyKey = null) {
      if (idempotencyKey !== null) {
        const existing = selectByKey.get(idempotencyKey) as unknown as EventRow | undefined;
        if (existing) return { stored: rowToStored(existing), created: false };
      }
      const id = randomUUID();
      const info = insert.run(id, event.type, JSON.stringify(event), occurredAt, idempotencyKey);
      return {
        stored: { seq: Number(info.lastInsertRowid), id, occurredAt, event, idempotencyKey },
        created: true,
      };
    },
    readAll() {
      return (selectAll.all() as unknown as EventRow[]).map(rowToStored);
    },
    clear() {
      db.exec("DELETE FROM events");
    },
    backupTo(target) {
      // VACUUM INTO copies the live database in one read transaction, so the snapshot is consistent
      // even mid-write; a plain file copy could catch a half-applied write.
      db.prepare("VACUUM INTO ?").run(target);
    },
  };
}
