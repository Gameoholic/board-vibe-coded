import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { startBackups } from "./backup.js";
import { openEventStore } from "./db.js";
import { ApiError } from "./errors.js";
import { BoardStore } from "./projection.js";
import { buildRouter } from "./routes.js";
import { initializeBoard } from "./seed.js";

const events = openEventStore();
const store = new BoardStore(events);
initializeBoard(store);
startBackups(events);

const app = express();

// Locked to the dev web origin rather than open to all — the API is the sole authority on the data
// and shouldn't answer cross-origin callers. In production the web app is served same-origin behind
// nginx; override via WEB_ORIGIN (comma-separated) if that changes.
const allowedOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((o) => o.trim());
app.use(cors({ origin: allowedOrigins }));

// Cap the body size — these payloads are tiny; anything larger is malformed or hostile.
app.use(express.json({ limit: "64kb" }));

app.use("/api", buildRouter(store));

// Central error boundary: validation failures → 400, command errors → their status, else 500.
// Never leak internals or stack traces to the client.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "validation failed", issues: err.issues });
    return;
  }
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("unhandled error", err);
  res.status(500).json({ error: "internal error" });
});

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
// Loopback only: the API has no auth of its own, so it must only be reachable through the proxy in
// front of it (Vite in dev, nginx in production) — never directly on a public interface.
app.listen(port, "127.0.0.1", () => {
  console.log(`api listening on http://localhost:${port}`);
});
