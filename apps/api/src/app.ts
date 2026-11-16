import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { readAccounts } from "./accounts.js";
import { buildAuthRouter, serveBoards } from "./authRoutes.js";
import { Boards } from "./boards.js";
import { ApiError } from "./errors.js";

/** The API over the accounts in `dir` — the server's, or a test's scratch folder. */
export function buildApp(dir: string): { app: Express; boards: Boards } {
  // Every account's board opened now, so each one's backups keep their pace whether or not it's visited.
  const boards = new Boards(dir);
  for (const account of readAccounts(dir) ?? []) boards.get(account);

  const app = express();
  // Trust nginx's X-Forwarded-Proto in production so `req.secure` is correct behind the reverse proxy
  // (the API itself only ever speaks plain HTTP on its loopback socket) — that decides whether the
  // session cookie gets the `Secure` attribute.
  app.set("trust proxy", 1);

  // Locked to the dev web origin rather than open to all — the API is the sole authority on the data
  // and shouldn't answer cross-origin callers. In production the web app is served same-origin behind
  // nginx; override via WEB_ORIGIN (comma-separated) if that changes.
  const allowedOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((o) => o.trim());
  app.use(cors({ origin: allowedOrigins }));

  // Cap the body size — these payloads are tiny; anything larger is malformed or hostile.
  app.use(express.json({ limit: "64kb" }));

  // Login and status stay open; everything else under /api is served from the board of the account the
  // session cookie names.
  app.use("/api/auth", buildAuthRouter(dir));
  app.use("/api", serveBoards(dir, boards));

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

  return { app, boards };
}
