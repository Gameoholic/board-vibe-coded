import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import "./AuthGate.css";
import Form from "./Form";

interface Status {
  configured: boolean;
  authenticated: boolean;
}

/** Blocks rendering `children` until the device is logged in to an account — the API rejects every
 * route except /api/auth/* without a session cookie naming one (ARCHITECTURE.md → "Security
 * architecture"). This gate is what shows the login form instead of a page full of failed fetches. */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | "loading">("loading");
  const [name, setName] = useState("");
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
        body: JSON.stringify({ name, password }),
      });
      if (!res.ok) {
        setError("Wrong name or password.");
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
          <p>There's no account yet.</p>
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
        <Form
          className="auth-gate-card"
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <h1>Board</h1>
          <input
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="auth-gate-error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={submitting || !name.trim() || !password}>
            Log in
          </button>
        </Form>
      </div>
    );
  }

  return <>{children}</>;
}
