import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../dist/app.js";

// What the accounts and invites tests share: a scratch data folder, and the real app over it.

/** A scratch folder, deleted when the test ends — after whatever was opened in it lets go. */
export function scratch(t, prefix = "board-accounts-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const closers = [];
  t.after(() => {
    for (const close of closers.reverse()) close();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, onClose: (fn) => closers.push(fn) };
}

/** The real app over a data folder, on a free port: a `call(path, { cookie, method, body })`. */
export async function serve(dir, onClose) {
  const { app, boards } = buildApp(dir);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  onClose(() => {
    server.close();
    boards.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (path, { cookie, method = "GET", body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get("set-cookie");
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, setCookie, cookie: setCookie?.split(";")[0] };
  };
}

export const logInAs = (call, name, password) => call("/api/auth/login", { method: "POST", body: { name, password } });
