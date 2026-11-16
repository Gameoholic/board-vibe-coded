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
