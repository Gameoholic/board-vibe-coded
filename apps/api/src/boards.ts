import type { Router } from "express";
import { type Account, accountDbFile } from "./accounts.js";
import { startBackups } from "./backup.js";
import { Clock } from "./clock.js";
import { type EventStore, openEventStore } from "./db.js";
import { BoardStore } from "./projection.js";
import { buildRouter } from "./routes.js";
import { initializeBoard } from "./seed.js";

// Each account's board, open for the server's life: its own event log, settings (which live in that
// log), backups (beside it) and debug clock — nothing shared between two accounts but the process.
// A request reaches a board only through the account its session cookie names (authRoutes.ts).

// A new account's weeks start on Monday (1; 0 is Sunday). The install's first account keeps whatever its
// board already had.
const NEW_BOARD_WEEK_START = 1;

/** Whether the runtime knows this IANA timezone — an unknown one would break every day and week boundary. */
function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

interface Board {
  store: BoardStore;
  router: Router;
  events: EventStore;
}

export class Boards {
  private readonly open = new Map<string, Board>();

  constructor(private readonly dir: string) {}

  /** The account's board, opened on first use — a new account's starts as the placeholder board. */
  get(account: Account): Board {
    let board = this.open.get(account.id);
    if (!board) {
      board = openBoard(this.dir, account);
      this.open.set(account.id, board);
    }
    return board;
  }

  /**
   * A just-made account's board, set to where its owner is: their browser's timezone (when it's a real one)
   * and weeks that start on Monday. Everything else is the placeholder board's defaults.
   */
  start(account: Account, timeZone: string | undefined): void {
    const { store } = this.get(account);
    store.patchSettings({ weekStartDay: NEW_BOARD_WEEK_START, ...(timeZone && isTimeZone(timeZone) ? { timeZone } : {}) });
  }

  /** Let go of every board's file (for tests; the server holds them for its whole life). */
  close(): void {
    for (const board of this.open.values()) board.events.close();
    this.open.clear();
  }
}

function openBoard(dir: string, account: Account): Board {
  const events = openEventStore(accountDbFile(dir, account.id));
  const store = new BoardStore(events, Math.random, new Clock());
  initializeBoard(store);
  const backups = startBackups(events, () => store.getSettings().backup);
  return { store, events, router: buildRouter(store, backups) };
}
