import { dataDir, findAccount, readAccounts, setAccountPassword } from "./accounts.js";
import { FIRST_ACCOUNT_NAME, migrateToAccounts } from "./migrateAccounts.js";

// Reads a line from the keyboard one key at a time. The password isn't echoed, so it never lands in
// shell history or a process list (unlike `pnpm set-password mypassword` would). The name is read the
// same way, echoed, so one reader owns the keyboard throughout.
function prompt(query: string, hidden: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(query);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        // The other half of a "\r\n" the last prompt ended on — not an empty answer to this one.
        if (char === "\n" && !value) continue;
        if (char === "\n" || char === "\r" || char === "\u0004") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          reject(new Error("cancelled"));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          if (!hidden && value) process.stdout.write("\b \b");
          value = value.slice(0, -1);
          continue;
        }
        if (!hidden) process.stdout.write(char);
        value += char;
      }
    };
    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode?.(wasRaw ?? false);
      stdin.pause();
    };
    stdin.on("data", onData);
  });
}

async function main() {
  // Before reading the accounts: on an install not yet booted since the update, this makes them.
  const dir = dataDir();
  migrateToAccounts(dir, FIRST_ACCOUNT_NAME);
  const accounts = readAccounts(dir) ?? [];

  const name = (await prompt(accounts.length ? "Account name: " : "Name for the first account: ", false)).trim();
  if (!name) {
    console.error("A name is needed — nothing was changed.");
    process.exitCode = 1;
    return;
  }
  if (accounts.length && !findAccount(accounts, name)) {
    console.error("No account has that name — nothing was changed.");
    process.exitCode = 1;
    return;
  }

  const first = await prompt("New password: ", true);
  if (first.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exitCode = 1;
    return;
  }
  const second = await prompt("Confirm password: ", true);
  if (first !== second) {
    console.error("Passwords didn't match — nothing was changed.");
    process.exitCode = 1;
    return;
  }
  const result = setAccountPassword(dir, name, first);
  console.log(
    result === "created"
      ? `Account "${name}" made — log in with it.`
      : `Password set. Every device logged in to "${name}" is now logged out.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
