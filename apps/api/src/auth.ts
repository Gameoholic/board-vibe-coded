import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { type Account, findAccount, hashPassword, verifyPasswordHash } from "./accounts.js";

// Logging in, and the session cookie that says whose board a device is on.
//
// The cookie is stateless: `<account id>.<HMAC-SHA256(that account's sessionSecret, "board-session:<id>")>`.
// No session store to clean up, and a password change rotates that one account's secret, which logs out
// exactly its devices and nobody else's.

const SESSION_MESSAGE = "board-session";

function sign(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

const macOf = (account: Account) => sign(account.sessionSecret, `${SESSION_MESSAGE}:${account.id}`);

/** The session cookie's value for an account. */
export function sessionFor(account: Account): string {
  return `${account.id}.${macOf(account)}`;
}

/** The account a session cookie belongs to, or null when it belongs to none. */
export function accountOfSession(accounts: Account[], token: string | undefined): Account | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot === -1) {
    // A cookie from before accounts: the bare HMAC of the old fixed message, under the secret the moved-in
    // board kept. Accepted so no device is logged out by the update; the caller swaps it for a new one.
    const legacy = accounts.find((a) => a.legacySession);
    return legacy && sameHex(token, sign(legacy.sessionSecret, SESSION_MESSAGE)) ? legacy : null;
  }
  const account = accounts.find((a) => a.id === token.slice(0, dot));
  return account && sameHex(token.slice(dot + 1), macOf(account)) ? account : null;
}

// Checked against when no account has the name, so a wrong name costs the same scrypt as a wrong password
// and the answer's timing can't tell whether a name exists.
const NOBODY = hashPassword(randomBytes(16).toString("hex"));

/** The account a name and password log in to, or null — the same null, in the same time, for either mistake. */
export function logIn(accounts: Account[], name: string, password: string): Account | null {
  const account = findAccount(accounts, name);
  const ok = verifyPasswordHash(password, account?.passwordHash ?? NOBODY);
  return account && ok ? account : null;
}
