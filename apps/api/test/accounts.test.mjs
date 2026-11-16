import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { accountDbFile, hashPassword, readAccounts, setAccountPassword, writeAccounts } from "../dist/accounts.js";
import { logIn } from "../dist/auth.js";
import { backupIfDue } from "../dist/backup.js";
import { openEventStore } from "../dist/db.js";
import { migrateToAccounts } from "../dist/migrateAccounts.js";
import { BoardStore } from "../dist/projection.js";
import { initializeBoard } from "../dist/seed.js";
import { logInAs, scratch, serve } from "./serve.mjs";

const PASSWORD = "the-old-password";
const STEPS = ["planned", "backed-up", "board-moved", "backups-moved", "accounts-written"];

// A data folder shaped like one from before accounts: a board.db that's been used (a day opened, tasks
// ticked and added), its backups/ folder, and auth.json with a password hash and a session secret.
function legacyDataDir(t) {
  const { root, onClose } = scratch(t);
  const events = openEventStore(join(root, "board.db"));
  const store = new BoardStore(events);
  initializeBoard(store);
  store.rollPeriod("day");
  const [daily] = store.listSections();
  store.setDone(store.listTasks(daily.id)[0].id, true);
  store.createTask({ sectionId: daily.id, type: "checkbox", text: "Stretch", points: 1500 });
  backupIfDue(events, join(root, "backups"), { enabled: true, everyHours: 48, keep: 5 });
  store.createTask({ sectionId: daily.id, type: "checkbox", text: "Read", points: 750 });
  const tasks = store.listTasks();
  events.close();

  const auth = { passwordHash: hashPassword(PASSWORD), sessionSecret: randomBytes(32).toString("hex") };
  writeFileSync(join(root, "auth.json"), JSON.stringify(auth));
  return {
    root,
    onClose,
    auth,
    tasks,
    rows: rawRows(join(root, "board.db")),
    sha: sha(join(root, "board.db")),
    backups: readdirSync(join(root, "backups")),
  };
}

// Every column of every event, straight from the file — not through the projection.
function rawRows(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare("SELECT * FROM events ORDER BY seq").all().map((row) => ({ ...row }));
  } finally {
    db.close();
  }
}

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

// Every file under a folder with its bytes' hash — to see that a second boot changes nothing at all.
function tree(root, dir = root) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? tree(root, path) : [[relative(root, path), sha(path)]];
    });
}

function assertMigrated(legacy) {
  const { root } = legacy;
  const accounts = readAccounts(root);
  assert.equal(accounts.length, 1);
  const [account] = accounts;
  assert.equal(account.name, "daniel");
  assert.equal(account.passwordHash, legacy.auth.passwordHash);
  assert.equal(account.sessionSecret, legacy.auth.sessionSecret);

  // The board itself: the very same bytes, every event identical.
  const db = accountDbFile(root, account.id);
  assert.equal(sha(db), legacy.sha);
  assert.deepEqual(rawRows(db), legacy.rows);
  assert.deepEqual(readdirSync(join(root, "accounts", account.id, "backups")), legacy.backups);

  // Nothing left in the old places, and a backup of how it was.
  for (const gone of ["board.db", "auth.json", "backups", "accounts-migration.json"]) assert.ok(!existsSync(join(root, gone)), gone);
  const [backup, ...more] = readdirSync(root).filter((f) => f.startsWith("pre-accounts-backup-"));
  assert.equal(more.length, 0);
  assert.ok(!backup.endsWith(".partial"));
  assert.equal(sha(join(root, backup, "board.db")), legacy.sha);
  assert.deepEqual(JSON.parse(readFileSync(join(root, backup, "auth.json"), "utf8")), legacy.auth);
  return account;
}

function addAccount(root, name, password) {
  const account = {
    id: randomUUID(),
    name,
    passwordHash: hashPassword(password),
    sessionSecret: randomBytes(32).toString("hex"),
    createdAt: new Date().toISOString(),
  };
  writeAccounts(root, [...(readAccounts(root) ?? []), account]);
  return account;
}

// ---- the migration ----

test("the board moves into its own account untouched, with a backup taken first", async (t) => {
  const legacy = legacyDataDir(t);
  assert.equal(migrateToAccounts(legacy.root, "daniel"), true);
  assertMigrated(legacy);

  // And it's the same board through the app, under the same password.
  const call = await serve(legacy.root, legacy.onClose);
  const login = await logInAs(call, "daniel", PASSWORD);
  assert.equal(login.status, 204);
  const tasks = await call("/api/tasks", { cookie: login.cookie });
  assert.deepEqual(tasks.json, legacy.tasks);
});

test("a second boot changes nothing", (t) => {
  const legacy = legacyDataDir(t);
  migrateToAccounts(legacy.root, "daniel");
  const after = tree(legacy.root);
  assert.equal(migrateToAccounts(legacy.root, "daniel"), false);
  assert.deepEqual(tree(legacy.root), after);
});

for (const step of STEPS) {
  test(`a boot that dies after "${step}" loses nothing, and the next one finishes`, (t) => {
    const legacy = legacyDataDir(t);
    assert.throws(
      () =>
        migrateToAccounts(legacy.root, "daniel", (s) => {
          if (s === step) throw new Error("power cut");
        }),
      /power cut/,
    );
    // At the moment it died, the board is whole in one place or the other.
    const plan = JSON.parse(readFileSync(join(legacy.root, "accounts-migration.json"), "utf8"));
    const where = [join(legacy.root, "board.db"), accountDbFile(legacy.root, plan.id)].filter(existsSync);
    assert.equal(where.length, 1);
    assert.equal(sha(where[0]), legacy.sha);

    assert.equal(migrateToAccounts(legacy.root, "daniel"), true);
    assertMigrated(legacy);
  });
}

test("a backup cut off halfway is taken again", (t) => {
  const legacy = legacyDataDir(t);
  assert.throws(() =>
    migrateToAccounts(legacy.root, "daniel", (s) => {
      if (s === "planned") throw new Error("power cut");
    }),
  );
  const plan = JSON.parse(readFileSync(join(legacy.root, "accounts-migration.json"), "utf8"));
  mkdirSync(join(legacy.root, `${plan.backupDir}.partial`));
  writeFileSync(join(legacy.root, `${plan.backupDir}.partial`, "board.db"), "half a file");

  migrateToAccounts(legacy.root, "daniel");
  assertMigrated(legacy);
});

test("a file already where the board would go stops the move, touching nothing", (t) => {
  const legacy = legacyDataDir(t);
  assert.throws(() =>
    migrateToAccounts(legacy.root, "daniel", (s) => {
      if (s === "backed-up") throw new Error("power cut");
    }),
  );
  const plan = JSON.parse(readFileSync(join(legacy.root, "accounts-migration.json"), "utf8"));
  mkdirSync(join(legacy.root, "accounts", plan.id), { recursive: true });
  writeFileSync(accountDbFile(legacy.root, plan.id), "someone else's");

  assert.throws(() => migrateToAccounts(legacy.root, "daniel"), /stopped/);
  assert.equal(sha(join(legacy.root, "board.db")), legacy.sha);
  assert.equal(readAccounts(legacy.root), null);
});

test("a fresh install has nothing to move", (t) => {
  const { root } = scratch(t);
  assert.equal(migrateToAccounts(root, "daniel"), false);
  assert.deepEqual(readdirSync(root), []);
});

// ---- logging in ----

test("a wrong name and a wrong password get the same answer", async (t) => {
  const legacy = legacyDataDir(t);
  migrateToAccounts(legacy.root, "daniel");
  const call = await serve(legacy.root, legacy.onClose);

  const wrongName = await logInAs(call, "nobody", PASSWORD);
  const wrongPassword = await logInAs(call, "daniel", "not-it");
  assert.equal(wrongName.status, 401);
  assert.deepEqual(wrongName, wrongPassword);
  // The name is matched without minding case or the spaces around it.
  assert.equal((await logInAs(call, "  Daniel ", PASSWORD)).status, 204);
});

test("a wrong name takes as long to refuse as a wrong password", (t) => {
  const legacy = legacyDataDir(t);
  migrateToAccounts(legacy.root, "daniel");
  const accounts = readAccounts(legacy.root);
  const median = (fn) => {
    const times = Array.from({ length: 7 }, () => {
      const start = process.hrtime.bigint();
      assert.equal(fn(), null);
      return Number(process.hrtime.bigint() - start);
    });
    return times.sort((a, b) => a - b)[3];
  };
  const name = median(() => logIn(accounts, "nobody", PASSWORD));
  const password = median(() => logIn(accounts, "daniel", "not-it"));
  // Both pay one scrypt; without the stand-in hash a missing name would answer ~1000× faster.
  assert.ok(name / password > 0.5 && name / password < 2, `${name} vs ${password}`);
});

// ---- the session cookie ----

test("the cookie names its account and is renewed on each visit", async (t) => {
  const legacy = legacyDataDir(t);
  migrateToAccounts(legacy.root, "daniel");
  const [account] = readAccounts(legacy.root);
  const call = await serve(legacy.root, legacy.onClose);

  const login = await logInAs(call, "daniel", PASSWORD);
  assert.match(
    login.setCookie,
    new RegExp(`^board_session=${account.id}\\.[0-9a-f]{64}; Path=/; HttpOnly; SameSite=Lax; Max-Age=34560000$`),
  );

  const status = await call("/api/auth/status", { cookie: login.cookie });
  assert.deepEqual(status.json, { configured: true, authenticated: true });
  assert.equal(status.cookie, login.cookie);
  assert.match(status.setCookie, /Max-Age=34560000/);

  // Tampered with, or no cookie at all: not logged in, and nothing renewed.
  const tampered = login.cookie.slice(0, -1) + (login.cookie.endsWith("0") ? "1" : "0");
  for (const cookie of [tampered, undefined]) {
    const res = await call("/api/auth/status", { cookie });
    assert.deepEqual(res.json, { configured: true, authenticated: false });
    assert.equal(res.setCookie, null);
    assert.equal((await call("/api/tasks", { cookie })).status, 401);
  }
});

test("a device logged in before accounts stays logged in, and gets a cookie that names its account", async (t) => {
  const legacy = legacyDataDir(t);
  // Exactly what the server used to set.
  const old = `board_session=${createHmac("sha256", legacy.auth.sessionSecret).update("board-session").digest("hex")}`;
  migrateToAccounts(legacy.root, "daniel");
  const [account] = readAccounts(legacy.root);
  const call = await serve(legacy.root, legacy.onClose);

  assert.equal((await call("/api/tasks", { cookie: old })).status, 200);
  const status = await call("/api/auth/status", { cookie: old });
  assert.equal(status.json.authenticated, true);
  assert.ok(status.cookie.startsWith(`board_session=${account.id}.`));
  assert.equal((await call("/api/tasks", { cookie: status.cookie })).status, 200);
});

test("a password change logs out that account's devices and nobody else's", async (t) => {
  const legacy = legacyDataDir(t);
  const old = `board_session=${createHmac("sha256", legacy.auth.sessionSecret).update("board-session").digest("hex")}`;
  migrateToAccounts(legacy.root, "daniel");
  addAccount(legacy.root, "friend", "friend-password");
  const call = await serve(legacy.root, legacy.onClose);
  const daniel = (await logInAs(call, "daniel", PASSWORD)).cookie;
  const friend = (await logInAs(call, "friend", "friend-password")).cookie;

  assert.equal(setAccountPassword(legacy.root, "Daniel", "a-new-password"), "changed");
  for (const cookie of [daniel, old]) assert.equal((await call("/api/tasks", { cookie })).status, 401);
  assert.equal((await call("/api/tasks", { cookie: friend })).status, 200);
  assert.equal((await logInAs(call, "daniel", "a-new-password")).status, 204);
});

// ---- accounts never meet ----

test("one account never reads another's board, clock or cookie", async (t) => {
  const legacy = legacyDataDir(t);
  migrateToAccounts(legacy.root, "daniel");
  const [owner] = readAccounts(legacy.root);
  const other = addAccount(legacy.root, "friend", "friend-password");
  const call = await serve(legacy.root, legacy.onClose);
  const daniel = (await logInAs(call, "daniel", PASSWORD)).cookie;
  const friend = (await logInAs(call, "friend", "friend-password")).cookie;

  // A new account starts on the placeholder board, none of the owner's in it.
  const theirs = (await call("/api/tasks", { cookie: friend })).json;
  assert.ok(theirs.length > 0);
  const ownerIds = new Set(legacy.tasks.map((task) => task.id));
  assert.ok(theirs.every((task) => !ownerIds.has(task.id) && !["Stretch", "Read"].includes(task.text)));

  // What one adds, the other never sees.
  const [section] = (await call("/api/sections", { cookie: daniel })).json;
  const added = await call("/api/tasks", {
    cookie: daniel,
    method: "POST",
    body: { sectionId: section.id, type: "checkbox", text: "Private", points: 1000 },
  });
  assert.equal(added.status, 201);
  assert.ok(!(await call("/api/tasks", { cookie: friend })).json.some((task) => task.text === "Private"));
  // Not even by naming the owner's tab or task outright.
  assert.equal((await call(`/api/tasks/${added.json.id}`, { cookie: friend, method: "PATCH", body: { text: "x" } })).status, 404);

  // Each has its own file — not one shared log filtered by person.
  assert.ok(!rawRows(accountDbFile(legacy.root, other.id)).some((row) => row.payload.includes("Private")));
  assert.ok(rawRows(accountDbFile(legacy.root, owner.id)).some((row) => row.payload.includes("Private")));

  // One's debug time is theirs alone.
  await call("/api/debug/clock", { cookie: daniel, method: "POST", body: { at: "2030-01-01T09:00:00.000Z" } });
  assert.equal((await call("/api/debug/clock", { cookie: friend })).json.now, null);

  // A cookie naming one account but signed with another's secret opens neither.
  const forged = `board_session=${owner.id}.${friend.split(".")[1]}`;
  assert.equal((await call("/api/tasks", { cookie: forged })).status, 401);
});
