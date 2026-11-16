import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { InviteLink, NewInviteLink } from "@board/contracts";
import { type Account, type Invite, findAccount, newAccount, readAccountsData, writeAccountsData } from "./accounts.js";

// Invite links: how a second account comes to exist. The install's own account makes a one-time link in
// Settings; whoever opens it picks a name and password and gets a board of their own. There is no other
// way in: no sign-up page, and the terminal only ever makes the first account.
//
// A link carries a random code; the accounts file keeps only its SHA-256, so the file alone can't be turned
// back into a working link. (A fast hash is enough here: the code is 256 random bits, not a password.)

/** How long a link works for, if nobody uses or cancels it first. */
export const INVITE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const hashOf = (code: string) => createHash("sha256").update(code).digest("hex");

const asLink = (invite: Invite): InviteLink => ({ id: invite.id, createdAt: invite.createdAt, expiresAt: invite.expiresAt });

const isOpen = (invite: Invite, now: Date) => !invite.usedAt && !invite.cancelledAt && Date.parse(invite.expiresAt) > now.getTime();

/** A new link made by `by`. Its code is in the answer and nowhere else. */
export function makeInvite(dir: string, by: Account, now = new Date()): NewInviteLink {
  const data = readAccountsData(dir) ?? { accounts: [], invites: [] };
  // base64url: it goes in a link as it is.
  const code = randomBytes(32).toString("base64url");
  const invite: Invite = {
    id: randomUUID(),
    tokenHash: hashOf(code),
    createdBy: by.id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + INVITE_DAYS * DAY_MS).toISOString(),
  };
  writeAccountsData(dir, { ...data, invites: [...data.invites, invite] });
  return { ...asLink(invite), code };
}

/** The links `by` made that still work, oldest first. */
export function openInvites(dir: string, by: Account, now = new Date()): InviteLink[] {
  const invites = readAccountsData(dir)?.invites ?? [];
  return invites.filter((invite) => invite.createdBy === by.id && isOpen(invite, now)).map(asLink);
}

/** Stops one of `by`'s links working. False when there's no such link of theirs still open. */
export function cancelInvite(dir: string, by: Account, id: string, now = new Date()): boolean {
  const data = readAccountsData(dir);
  const invite = data?.invites.find((i) => i.id === id && i.createdBy === by.id && isOpen(i, now));
  if (!data || !invite) return false;
  const cancelled = { ...invite, cancelledAt: now.toISOString() };
  writeAccountsData(dir, { ...data, invites: data.invites.map((i) => (i === invite ? cancelled : i)) });
  return true;
}

// The link a code opens, while it still works. A used, cancelled, expired or made-up code all come back
// the same: undefined.
function liveInvite(invites: Invite[], code: string, now: Date): Invite | undefined {
  const hash = hashOf(code);
  return invites.find((invite) => invite.tokenHash === hash && isOpen(invite, now));
}

/** Whether a code opens a link that still works. */
export function inviteWorks(dir: string, code: string, now = new Date()): boolean {
  return liveInvite(readAccountsData(dir)?.invites ?? [], code, now) !== undefined;
}

export type JoinResult = { account: Account } | "dead" | "taken";

/**
 * Makes an account from a link: spends the link and adds the account in one write of the accounts file,
 * so a crash leaves both done or neither. "taken" leaves the link working, to try another name.
 */
export function joinWithInvite(dir: string, code: string, name: string, password: string, now = new Date()): JoinResult {
  const data = readAccountsData(dir);
  const invite = data && liveInvite(data.invites, code, now);
  if (!data || !invite) return "dead";
  // Asked only of someone holding a working link — and it tells them about this one name, nothing more.
  if (findAccount(data.accounts, name)) return "taken";
  const account = newAccount(name, password, now);
  const used = { ...invite, usedAt: now.toISOString() };
  writeAccountsData(dir, {
    accounts: [...data.accounts, account],
    invites: data.invites.map((i) => (i === invite ? used : i)),
  });
  return { account };
}
