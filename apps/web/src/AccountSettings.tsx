import { useEffect, useRef, useState } from "react";
import { InviteLink as InviteLinkSchema, NewInviteLink as NewInviteLinkSchema } from "@board/contracts";
import ConfirmPopover from "./ConfirmPopover";
import type { InviteLink, NewInviteLink } from "./types";

// Settings' account sections: invite links (only on the account that may make them — on any other, the
// server says there's nothing there and the section isn't drawn at all) and logging this device out.

/** Where an invite link's code goes: after `#`, so it never reaches the server's logs or another site's. */
export const JOIN_HASH = "join";

const linkFor = (code: string) => `${window.location.origin}/#${JOIN_HASH}=${code}`;

export function InviteSettings({ timeZone }: { timeZone: string }) {
  // null: not loaded yet, or this account doesn't make invites — either way, nothing to draw.
  const [links, setLinks] = useState<InviteLink[] | null>(null);
  const [made, setMade] = useState<NewInviteLink | null>(null);
  const [making, setMaking] = useState(false);

  const load = () =>
    fetch("/api/invites")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setLinks(data === null ? null : InviteLinkSchema.array().parse(data)));

  useEffect(() => {
    void load();
  }, []);

  async function make() {
    setMaking(true);
    try {
      const res = await fetch("/api/invites", { method: "POST" });
      if (!res.ok) return;
      setMade(NewInviteLinkSchema.parse(await res.json()));
      await load();
    } finally {
      setMaking(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/invites/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (made?.id === id) setMade(null);
    await load();
  }

  if (!links) return null;
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone });
  const moment = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });

  return (
    <section className="settings-group">
      <h2 className="settings-heading">Invites</h2>
      <p className="settings-note">An invite link lets one person make an account, with a board of their own. It works once, within a week.</p>

      {made && <NewLink link={linkFor(made.code)} />}

      <div>
        <button type="button" className="ghost-btn" disabled={making} onClick={() => void make()}>
          Make an invite link
        </button>
      </div>

      {links.length > 0 && (
        <div className="field">
          <span className="field-label">Waiting to be used</span>
          <ul className="invite-links">
            {links.map((link) => (
              <WaitingLink
                key={link.id}
                label={`Made ${day(link.createdAt)} · works until ${moment(link.expiresAt)}`}
                onDelete={() => void remove(link.id)}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// The link just made, with a way to copy it. Where the page may not write to the clipboard (plain http
// away from localhost), the copy button selects the link instead, to copy by hand.
function NewLink({ link }: { link: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }

  return (
    <div className="field">
      <span className="field-label">Your new link</span>
      <div className="invite-new">
        <input ref={inputRef} type="text" readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn-primary" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <span className="field-hint">You'll only see it this once.</span>
    </div>
  );
}

function WaitingLink({ label, onDelete }: { label: string; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="invite-link">
      <span>{label}</span>
      <div className="popover-anchor">
        <button type="button" className="ghost-btn" onClick={() => setConfirming(true)}>
          Delete
        </button>
        <ConfirmPopover
          open={confirming}
          message="Delete this invite link? It stops working at once."
          onConfirm={() => {
            setConfirming(false);
            onDelete();
          }}
          onCancel={() => setConfirming(false)}
        />
      </div>
    </li>
  );
}

export function LogOutSettings() {
  const [confirming, setConfirming] = useState(false);

  async function logOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    // From the top, so nothing of the board is left on screen behind the login.
    window.location.reload();
  }

  return (
    <section className="settings-group">
      <h2 className="settings-heading">Account</h2>
      <div className="popover-anchor">
        <button type="button" className="ghost-btn" onClick={() => setConfirming(true)}>
          Log out
        </button>
        <ConfirmPopover
          open={confirming}
          message="Log out on this device? You'll need your password to log back in."
          confirmLabel="Log out"
          danger={false}
          onConfirm={() => {
            setConfirming(false);
            void logOut();
          }}
          onCancel={() => setConfirming(false)}
        />
      </div>
    </section>
  );
}
