import { LoginBody } from "@board/contracts";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { isPasswordConfigured, isValidSessionToken, verifyPassword } from "./auth.js";

export const SESSION_COOKIE = "board_session";
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

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

function setSessionCookie(req: Request, res: Response, token: string): void {
  // Secure only when the request actually arrived over HTTPS (directly, or via nginx's
  // X-Forwarded-Proto with `app.set("trust proxy", ...)` in index.ts) — a hard `Secure` would silently
  // drop the cookie during local `pnpm dev` over plain http.
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(TEN_YEARS_MS / 1000)}`,
  ];
  if (req.secure) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

/** Unauthenticated: login and "am I logged in" status. Mounted before `requireAuth`. */
export function buildAuthRouter(): Router {
  const router = Router();

  router.get("/status", (req, res) => {
    res.json({
      configured: isPasswordConfigured(),
      authenticated: isValidSessionToken(readCookie(req, SESSION_COOKIE)),
    });
  });

  router.post("/login", (req, res) => {
    const { password } = LoginBody.parse(req.body);
    const token = verifyPassword(password);
    if (!token) {
      res.status(401).json({ error: "wrong password" });
      return;
    }
    setSessionCookie(req, res, token);
    res.status(204).end();
  });

  return router;
}

/** Gates every other `/api` route behind a valid session cookie. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isValidSessionToken(readCookie(req, SESSION_COOKIE))) {
    next();
    return;
  }
  res.status(401).json({ error: "not authenticated" });
}
