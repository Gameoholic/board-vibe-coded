import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { accountDbFile, accountsFile, readAccounts, setAccountPassword } from "../dist/accounts.js";
import { makeInvite } from "../dist/invites.js";
import { logInAs, scratch, serve } from "./serve.mjs";

const OWNER_PASSWORD = "owner-password";
const FRIEND_PASSWORD = "friend-password";
const DAY_MS = 24 * 60 * 60 * 1000;

// A fresh install with its first account made from the terminal, served, and logged in.
async function install(t) {
  const { root, onClose } = scratch(t, "board-invites-");
  assert.equal(setAccountPassword(root, "daniel", OWNER_PASSWORD), "created");
  const call = await serve(root, onClose);
  const owner = (await logInAs(call, "daniel", OWNER_PASSWORD)).cookie;
  const invite = async () => {
    const res = await call("/api/invites", { cookie: owner, method: "POST" });
    assert.equal(res.status, 201);
    return res.json;
  };
  const join = (code, name, password = FRIEND_PASSWORD) => call("/api/auth/join", { method: "POST", body: { code, name, password } });
  const check = (code) => call("/api/auth/invite", { method: "POST", body: { code } });
  return { root, call, owner, invite, join, check };
}

const rawPayloads = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare("SELECT payload FROM events").all().map((row) => row.payload);
  } finally {
    db.close();
  }
};

test("a link works once and only once, and logs its new account in", async (t) => {
  const { root, call, invite, join, check } = await install(t);
  const { code } = await invite();

  assert.equal((await check(code)).status, 204);
  const joined = await join(code, "Maya");
  assert.equal(joined.status, 204);
  assert.match(joined.cookie, /^board_session=[0-9a-f-]{36}\.[0-9a-f]{64}$/);
  assert.equal((await call("/api/tasks", { cookie: joined.cookie })).status, 200);
  assert.equal((await logInAs(call, "maya", FRIEND_PASSWORD)).status, 204);

  // Spent: not for a second account, not even under another name.
  assert.equal((await check(code)).status, 404);
  assert.equal((await join(code, "Someone else")).status, 404);
  const accounts = readAccounts(root);
  assert.deepEqual(
    accounts.map((a) => a.name),
    ["daniel", "Maya"],
  );
  // Let in by the owner, but can't let anyone in.
  assert.equal(accounts[1].canInvite, undefined);
});

test("a used, cancelled, expired or made-up link all fail the same way", async (t) => {
  const { root, call, owner, invite, join, check } = await install(t);
  const used = (await invite()).code;
  await join(used, "Maya");
  const cancelled = await invite();
  assert.equal((await call(`/api/invites/${cancelled.id}`, { cookie: owner, method: "DELETE" })).status, 204);
  const [ownerAccount] = readAccounts(root);
  const expired = makeInvite(root, ownerAccount, new Date(Date.now() - 8 * DAY_MS)).code;
  const madeUp = "x".repeat(43);

  const answers = [];
  for (const code of [used, cancelled.code, expired, madeUp]) {
    answers.push([await check(code), await join(code, "Another")]);
  }
  for (const [checked, joined] of answers) {
    assert.equal(checked.status, 404);
    assert.deepEqual(checked, answers[3][0]);
    assert.deepEqual(joined, answers[3][1]);
    assert.equal(joined.setCookie, null);
  }
  // None of them made an account.
  assert.deepEqual(
    readAccounts(root).map((a) => a.name),
    ["daniel", "Maya"],
  );
});

test("a link still works until it's 7 days old", async (t) => {
  const { root, check } = await install(t);
  const [owner] = readAccounts(root);
  const fresh = makeInvite(root, owner, new Date(Date.now() - 6 * DAY_MS));
  assert.equal((await check(fresh.code)).status, 204);
  assert.equal(Date.parse(fresh.expiresAt) - Date.parse(fresh.createdAt), 7 * DAY_MS);
});

test("a new account's board starts in its browser's timezone, with weeks from Monday — the owner's is untouched", async (t) => {
  const { call, owner, invite } = await install(t);
  const before = (await call("/api/settings", { cookie: owner })).json;
  const joinFrom = async (name, timeZone) => {
    const { code } = await invite();
    const body = { code, name, password: FRIEND_PASSWORD, ...(timeZone ? { timeZone } : {}) };
    const joined = await call("/api/auth/join", { method: "POST", body });
    assert.equal(joined.status, 204);
    return (await call("/api/settings", { cookie: joined.cookie })).json;
  };

  const tokyo = await joinFrom("Maya", "Asia/Tokyo");
  assert.equal(tokyo.timeZone, "Asia/Tokyo");
  assert.equal(tokyo.weekStartDay, 1);

  // A zone the runtime doesn't know, or none sent, leaves the default zone; weeks still start on Monday.
  const bogus = await joinFrom("Kai", "Mars/Olympus");
  assert.equal(bogus.timeZone, before.timeZone);
  assert.equal(bogus.weekStartDay, 1);
  assert.equal((await joinFrom("Noa")).weekStartDay, 1);

  assert.deepEqual((await call("/api/settings", { cookie: owner })).json, before);
});

test("the new account gets a fresh board of its own, and neither reads the other's", async (t) => {
  const { root, call, owner, invite, join } = await install(t);
  const placeholder = (await call("/api/tasks", { cookie: owner })).json.map((task) => task.text);

  // The owner's board, used before the friend arrives.
  const [ownerSection] = (await call("/api/sections", { cookie: owner })).json;
  const ownerTask = await call("/api/tasks", {
    cookie: owner,
    method: "POST",
    body: { sectionId: ownerSection.id, type: "checkbox", text: "Owner's secret", points: 1000 },
  });
  assert.equal(ownerTask.status, 201);

  const friend = (await join((await invite()).code, "Maya")).cookie;
  // The placeholder board, exactly as a new install starts — not a copy of the owner's.
  const theirs = (await call("/api/tasks", { cookie: friend })).json;
  assert.deepEqual(
    theirs.map((task) => task.text),
    placeholder,
  );
  const ownerIds = new Set((await call("/api/tasks", { cookie: owner })).json.map((task) => task.id));
  assert.ok(theirs.every((task) => !ownerIds.has(task.id)));

  // What the friend adds, the owner never sees — and the other way round.
  const [friendSection] = (await call("/api/sections", { cookie: friend })).json;
  await call("/api/tasks", {
    cookie: friend,
    method: "POST",
    body: { sectionId: friendSection.id, type: "checkbox", text: "Friend's secret", points: 1000 },
  });
  const ownerSees = (await call("/api/tasks", { cookie: owner })).json.map((task) => task.text);
  const friendSees = (await call("/api/tasks", { cookie: friend })).json.map((task) => task.text);
  assert.ok(ownerSees.includes("Owner's secret") && !ownerSees.includes("Friend's secret"));
  assert.ok(friendSees.includes("Friend's secret") && !friendSees.includes("Owner's secret"));
  assert.equal(
    (await call(`/api/tasks/${ownerTask.json.id}`, { cookie: friend, method: "PATCH", body: { text: "x" } })).status,
    404,
  );

  // Two files, each holding only its own.
  const [danielAccount, maya] = readAccounts(root);
  const ownerLog = rawPayloads(accountDbFile(root, danielAccount.id));
  const friendLog = rawPayloads(accountDbFile(root, maya.id));
  assert.ok(ownerLog.some((p) => p.includes("Owner's secret")) && !ownerLog.some((p) => p.includes("Friend's secret")));
  assert.ok(friendLog.some((p) => p.includes("Friend's secret")) && !friendLog.some((p) => p.includes("Owner's secret")));
});

test("only the install's own account makes, lists or cancels links", async (t) => {
  const { call, owner, invite, join, check } = await install(t);
  const friend = (await join((await invite()).code, "Maya")).cookie;
  const pending = await invite();

  for (const cookie of [friend, undefined]) {
    for (const [method, path] of [
      ["GET", "/api/invites"],
      ["POST", "/api/invites"],
      ["DELETE", `/api/invites/${pending.id}`],
    ]) {
      const res = await call(path, { cookie, method });
      assert.equal(res.status, 404, `${method} ${path}`);
      assert.deepEqual(res.json, { error: "not found" });
    }
  }
  // The owner's link is untouched by the friend's try at cancelling it.
  assert.equal((await check(pending.code)).status, 204);
  assert.deepEqual(
    (await call("/api/invites", { cookie: owner })).json.map((link) => link.id),
    [pending.id],
  );
});

test("the owner's list shows links still waiting — never a code, never who used one", async (t) => {
  const { root, call, owner, invite, join } = await install(t);
  const used = await invite();
  await join(used.code, "Maya");
  const waiting = await invite();
  const [ownerAccount] = readAccounts(root);
  makeInvite(root, ownerAccount, new Date(Date.now() - 8 * DAY_MS));

  const list = (await call("/api/invites", { cookie: owner })).json;
  assert.deepEqual(list, [{ id: waiting.id, createdAt: waiting.createdAt, expiresAt: waiting.expiresAt }]);
  assert.ok(!JSON.stringify(list).includes("Maya"));

  // And the file never holds a code, only its hash.
  const file = readFileSync(accountsFile(root), "utf8");
  for (const code of [used.code, waiting.code]) assert.ok(!file.includes(code));
});

test("a taken name is said, the link keeps working, and a dead link never says it", async (t) => {
  const { invite, join, call } = await install(t);
  const { code } = await invite();

  const taken = await join(code, "  DANIEL ");
  assert.equal(taken.status, 409);
  assert.equal(taken.setCookie, null);
  assert.equal((await join(code, "Maya")).status, 204);
  // Spent now: the same taken name gets the dead-link answer, not "taken".
  assert.equal((await join(code, "daniel")).status, 404);
  // The owner's password is untouched.
  assert.equal((await logInAs(call, "daniel", OWNER_PASSWORD)).status, 204);
});

test("a new password must be 8 characters, and a name can't be blank", async (t) => {
  const { invite, join, check } = await install(t);
  const { code } = await invite();
  assert.equal((await join(code, "Maya", "short")).status, 400);
  assert.equal((await join(code, "   ")).status, 400);
  assert.equal((await check(code)).status, 204);
});

test("logging out drops this device's cookie and no other's", async (t) => {
  const { call, owner } = await install(t);
  const other = (await logInAs(call, "daniel", OWNER_PASSWORD)).cookie;

  const out = await call("/api/auth/logout", { cookie: owner, method: "POST" });
  assert.equal(out.status, 204);
  assert.match(out.setCookie, /^board_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0$/);
  assert.equal((await call("/api/tasks", { cookie: other })).status, 200);
});
