import { useEffect, useState } from "react";
import { PASSWORD_MIN } from "@board/contracts";
import Form from "./Form";

// What an invite link opens: a name and a password for a new account, in the login's own card. A link
// that doesn't work — used, deleted, too old or never made — says only that.

interface JoinCardProps {
  code: string;
  // The account is made and this device is logged in to it.
  onJoined: () => void;
  // Away from the link, to the login (or the board, on a device already logged in).
  onLeave: () => void;
}

export default function JoinCard({ code, onJoined, onLeave }: JoinCardProps) {
  const [link, setLink] = useState<"checking" | "open" | "dead">("checking");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/auth/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }).then((res) => setLink(res.ok ? "open" : "dead"));
  }, [code]);

  async function join() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, password, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      if (res.ok) onJoined();
      else if (res.status === 404) setLink("dead");
      else if (res.status === 409) setError("That name's taken.");
      else setError("That didn't work. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (link === "checking") return null;

  if (link === "dead") {
    return (
      <div className="auth-gate-card">
        <h1>Board</h1>
        <p>This invite link doesn't work anymore.</p>
        <button type="button" className="btn-primary" onClick={onLeave}>
          Continue
        </button>
      </div>
    );
  }

  return (
    <Form
      className="auth-gate-card"
      onSubmit={() => {
        if (password !== again) return { field: "again", message: "The passwords don't match" };
        void join();
      }}
    >
      <h1>Board</h1>
      <p>You're invited. Pick a name and a password.</p>
      <input
        autoFocus
        required
        maxLength={100}
        data-missing="Pick a name"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        type="password"
        required
        minLength={PASSWORD_MIN}
        maxLength={200}
        data-missing="Pick a password"
        autoComplete="new-password"
        placeholder={`Password (${PASSWORD_MIN}+ characters)`}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <input
        type="password"
        required
        data-field="again"
        data-missing="Type it once more"
        autoComplete="new-password"
        placeholder="Password again"
        value={again}
        onChange={(e) => setAgain(e.target.value)}
      />
      {error && <p className="auth-gate-error">{error}</p>}
      <button type="submit" className="btn-primary" disabled={submitting}>
        Create account
      </button>
    </Form>
  );
}
