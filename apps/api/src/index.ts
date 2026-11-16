import { dataDir } from "./accounts.js";
import { buildApp } from "./app.js";
import { FIRST_ACCOUNT_NAME, migrateToAccounts } from "./migrateAccounts.js";

// Before any database is opened: a board from before accounts is moved into its own account.
const dir = dataDir();
migrateToAccounts(dir, FIRST_ACCOUNT_NAME);

const { app } = buildApp(dir);
const port = process.env.PORT ? Number(process.env.PORT) : 4000;
// Loopback only: never exposed directly on a public interface, always reached through the proxy in
// front of it (Vite in dev, nginx in production).
app.listen(port, "127.0.0.1", () => {
  console.log(`api listening on http://localhost:${port}`);
});
