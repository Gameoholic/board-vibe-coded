import { PRIORITY_LOOKS } from "./taskPriority";
import { PRIORITIES } from "./types";
import type { TaskPriority } from "./types";

// A task form's Priority choice: the three, each with its arrows in its colour, one of them picked.

interface PriorityFieldProps {
  value: TaskPriority;
  onChange: (priority: TaskPriority) => void;
}

export default function PriorityField({ value, onChange }: PriorityFieldProps) {
  return (
    <div className="field">
      <span className="field-label">Priority</span>
      <div className="calc-pills" role="radiogroup" aria-label="Priority">
        {PRIORITIES.map((priority) => {
          const look = PRIORITY_LOOKS[priority];
          return (
            <button
              key={priority}
              type="button"
              role="radio"
              aria-checked={value === priority}
              className={`calc-pill priority-pill${value === priority ? " active" : ""}`}
              onClick={() => onChange(priority)}
            >
              <look.icon size={12} />
              {look.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
