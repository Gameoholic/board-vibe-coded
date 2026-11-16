import { LoginBody } from "@board/contracts";
import type { Request, RequestHandler, Response } from "express";
import { Router } from "express";
import { type Account, readAccounts } from "./accounts.js";
import { accountOfSession, logIn, sessionFor } from "./auth.js";
import type { Boards } from "./boards.js";

export const SESSION_COOKIE = "board_session";
// The longest a browser keeps a cookie, whatever the server asks (Chrome caps it at 400 days). Renewed on
// every visit, so a device only has to log in again after a year and more unused.
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

// Read on every request rather than held in memory, so `pnpm set-password` on a running server takes
// effect at once.
const accountsIn = (dir: string) => readAccounts(dir) ?? [];

const sessionAccount = (dir: string, req: Request) => accountOfSession(accountsIn(dir), readCookie(req, SESSION_COOKIE));

function setSessionCookie(req: Request, res: Response, account: Account): void {
  // Secure only when the request actually arrived over HTTPS (directly, or via nginx's
  // X-Forwarded-Proto with `app.set("trust proxy", ...)` in index.ts) — a hard `Secure` would silently
  // drop the cookie during local `pnpm dev` over plain http.
  const attrs = [`${SESSION_COOKIE}=${sessionFor(account)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${COOKIE_MAX_AGE_S}`];
  if (req.secure) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

/** Unauthenticated: login and "am I logged in" status. Mounted before `serveBoards`. */
export function buildAuthRouter(dir: string): Router {
  const router = Router();

  // Asked on every load of the app, so this is where a device's cookie is renewed — and where a cookie
  // from before accounts is swapped for one that names its account.
  router.get("/status", (req, res) => {
    const accounts = accountsIn(dir);
    const account = accountOfSession(accounts, readCookie(req, SESSION_COOKIE));
    if (account) setSessionCookie(req, res, account);
    res.json({ configured: accounts.length > 0, authenticated: account !== null });
  });

  router.post("/login", (req, res) => {
    const { name, password } = LoginBody.parse(req.body);
    const account = logIn(accountsIn(dir), name, password);
    if (!account) {
      // One answer for a wrong name and a wrong password, so the login can't tell whether a name exists.
      res.status(401).json({ error: "wrong name or password" });
      return;
    }
    setSessionCookie(req, res, account);
    res.status(204).end();
  });

  return router;
}

/** Every other `/api` route: served from the board of the account the session cookie names, or 401. */
export function serveBoards(dir: string, boards: Boards): RequestHandler {
  return (req, res, next) => {
    const account = sessionAccount(dir, req);
    if (!account) {
      res.status(401).json({ error: "not authenticated" });
      return;
    }
    boards.get(account).router(req, res, next);
  };
}
