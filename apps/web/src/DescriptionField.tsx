import { useState } from "react";

interface DescriptionFieldProps {
  value: string;
  onChange: (value: string) => void;
}

// A task's description in its add and edit forms. Most tasks have none, so it's folded to a "+ Description"
// line until it's wanted — and open from the start when there's one to show (editing a task that has it).
// To fold it again, remount with a changing `key`.
export default function DescriptionField({ value, onChange }: DescriptionFieldProps) {
  const [open, setOpen] = useState(value !== "");
  // Opened by hand, the field takes the cursor; one that was open already leaves it with the form's first field.
  const [opened, setOpened] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className="ghost-btn form-add-btn"
        onClick={() => {
          setOpened(true);
          setOpen(true);
        }}
      >
        + Description
      </button>
    );
  }
  return (
    <label className="field">
      <span className="field-label">Description</span>
      <textarea
        className="field-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        autoComplete="off"
        autoFocus={opened}
      />
    </label>
  );
}
