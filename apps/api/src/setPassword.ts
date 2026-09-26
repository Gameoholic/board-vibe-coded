import { setPassword } from "./auth.js";

// Reads the new password from stdin without echoing it to the terminal, so it never lands in shell
// history or a process list (unlike `pnpm set-password mypassword` would).
function promptHidden(query: string): Promise<string> {
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
          value = value.slice(0, -1);
          continue;
        }
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
  const first = await promptHidden("New board password: ");
  if (first.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exitCode = 1;
    return;
  }
  const second = await promptHidden("Confirm password: ");
  if (first !== second) {
    console.error("Passwords didn't match — nothing was changed.");
    process.exitCode = 1;
    return;
  }
  setPassword(first);
  console.log("Password set. Any existing logged-in sessions are now signed out.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
