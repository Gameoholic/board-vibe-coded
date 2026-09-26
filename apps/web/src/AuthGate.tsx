import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import "./AuthGate.css";

interface Status {
  configured: boolean;
  authenticated: boolean;
}

/** Blocks rendering `children` until the shared board password has been entered — see
 * ARCHITECTURE.md / CONVENTIONS.md: there is one password, no user accounts, and the API rejects
 * every route except /api/auth/* without a valid session cookie. This gate is what shows the login
 * form instead of a page full of failed fetches. */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | "loading">("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((data: Status) => setStatus(data));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("Wrong password.");
        setPassword("");
        return;
      }
      setStatus({ configured: true, authenticated: true });
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") return null;

  if (!status.configured) {
    return (
      <div className="auth-gate">
        <div className="auth-gate-card">
          <h1>Board</h1>
          <p>No password has been set yet.</p>
          <p className="auth-gate-hint">
            Run <code>pnpm set-password</code> on the server, then reload this page.
          </p>
        </div>
      </div>
    );
  }

  if (!status.authenticated) {
    return (
      <div className="auth-gate">
        <form className="auth-gate-card" onSubmit={handleSubmit}>
          <h1>Board</h1>
          <input
            type="password"
            autoFocus
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="auth-gate-error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={submitting || !password}>
            Unlock
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
