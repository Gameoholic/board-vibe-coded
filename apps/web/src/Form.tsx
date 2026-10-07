import { useCallback, useState } from "react";

// The app's form. Its fields keep the browser's own rules (required, min, step, a number that must parse) —
// but what's wrong is said in the app's bubble under the field, never in the browser's own. Every form is one of
// these: a bare <form> shows Chrome's "Please fill out this field." the moment a rule fails.

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Something wrong that only the form's own submit can tell ("Link at least one task"): where to say it — the
 *  element inside the form carrying this `data-field` — and what to say. */
export interface FormProblem {
  field: string;
  message: string;
}

interface FormProps {
  className?: string;
  // Called once every field's rules hold. It may still return a problem of its own, shown instead of submitting.
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => FormProblem | void;
  children: React.ReactNode;
}

const isField = (el: Element): el is Field =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;

// A required field holding only spaces is as empty as an empty one (the browser's own rule lets it through).
const isBlank = (field: Field) => field.required && field.value.trim() === "";

const fails = (field: Field) => field.willValidate && (!field.validity.valid || isBlank(field));

// What's wrong with a field, in the board's words. A field says its own for being left empty (`data-missing`:
// "Give it a name"); the rest read off the rule that failed.
function problemWith(field: Field): string {
  const v = field.validity;
  if (v.valueMissing || isBlank(field)) return field.dataset.missing ?? "Fill this in";
  if (v.badInput || v.typeMismatch) return field.type === "number" ? "That's not a number" : "That doesn't look right";
  if (v.rangeUnderflow) return `At least ${field.getAttribute("min")}`;
  if (v.rangeOverflow) return `At most ${field.getAttribute("max")}`;
  if (v.stepMismatch) return "Whole numbers only";
  if (v.tooLong) return "That's too long";
  return "That doesn't look right";
}

// The space (px) between a field and what's said about it — the tooltip's own gap.
const PROBLEM_GAP = 6;

// Just under an element, in the form's own pixels — read from layout offsets, not screen rects: a form can be
// drawn scaled (on the zoomed canvas), and a screen measurement would be off by that scale.
function placeUnder(el: HTMLElement, form: HTMLElement): { top: number; left: number } {
  let top = el.offsetHeight + PROBLEM_GAP;
  let left = 0;
  for (let node: HTMLElement | null = el; node && node !== form; node = node.offsetParent as HTMLElement | null) {
    top += node.offsetTop;
    left += node.offsetLeft;
  }
  return { top, left };
}

export default function Form({ className, onSubmit, children }: FormProps) {
  const [problem, setProblem] = useState<{ message: string; top: number; left: number } | null>(null);
  // It's said until the form is touched again: any edit or press in it.
  const clear = useCallback(() => setProblem(null), []);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const invalid = Array.from(form.elements).find((el): el is Field => isField(el) && fails(el));
    if (invalid) {
      invalid.focus();
      setProblem({ message: problemWith(invalid), ...placeUnder(invalid, form) });
      return;
    }
    const own = onSubmit(e);
    if (!own) return clear();
    const at = form.querySelector<HTMLElement>(`[data-field="${own.field}"]`) ?? form;
    at.scrollIntoView({ block: "nearest" });
    setProblem({ message: own.message, ...placeUnder(at, form) });
  }

  return (
    <form className={`app-form${className ? ` ${className}` : ""}`} noValidate onSubmit={handleSubmit} onInput={clear} onPointerDown={clear}>
      {children}
      {problem && (
        <span className="form-problem" role="alert" style={{ top: problem.top, left: problem.left }}>
          {problem.message}
        </span>
      )}
    </form>
  );
}
