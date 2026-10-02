import { formatPercent } from "@board/contracts";
import { modifierInk } from "./modifierLooks";
import { payout } from "./types";
import type { AppliedModifier } from "./types";

interface PointsBracketProps {
  // Point values as integer thousandths-of-a-percent (see @board/contracts points.ts).
  percents: number[];
  // What a completion is (or was) paid at — its modifiers (a Bounty's ×2, its frost, Subzero). The bracket
  // then shows what it pays, inked in their colours ("[10%]" pulls harder than "[5% ×2]"); each one's own
  // line under the task says what it does.
  modifiers?: readonly AppliedModifier[];
}

// Deliberately shared by the task row and by the flying-points copy: the flyer is supposed to
// read as *that row's own bracket* having lifted off the board, so both have to render from one
// place. A lookalike rebuilt from a formatted string is precisely what made the old animation
// look like a separate label pasted on top of the row.
//
// The <wbr/> sits before each separator, so the only break points are *between* whole numbers.
// Plain wrapping (even overflow-wrap: anywhere) split values like "2.4%" into "2" / ".4%" on a
// squeezed card. Before the "/" rather than after each segment also means there's never a break
// opportunity in front of the closing "]" — a single-value bracket can't wrap to "[0.5%" / "]".
function PointsBracket({ percents, modifiers = [] }: PointsBracketProps) {
  const ink = modifierInk(modifiers);
  return (
    <>
      [
      {percents.map((p, i) => (
        <span
          key={i}
          className={ink ? "points-modified" : undefined}
          style={ink ? ({ "--ink": ink } as React.CSSProperties) : undefined}
          title={ink ? `${formatPercent(p)} → ${formatPercent(payout(p, modifiers))}` : undefined}
        >
          {i > 0 && (
            <>
              <wbr />/
            </>
          )}
          {formatPercent(ink ? payout(p, modifiers) : p)}
        </span>
      ))}
      ]
    </>
  );
}

export default PointsBracket;
