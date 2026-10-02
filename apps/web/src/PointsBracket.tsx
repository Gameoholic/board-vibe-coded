import { boosted, formatPercent } from "@board/contracts";

interface PointsBracketProps {
  // Point values as integer thousandths-of-a-percent (see @board/contracts points.ts).
  percents: number[];
  // What a completion is (or was) paid at, when not ×1 — a Bounty's ×2. The bracket then shows what it
  // pays, marked as boosted ("[10%]" pulls harder than "[5% ×2]"); the factor is on the Bounty stamp.
  multiplier?: number;
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
function PointsBracket({ percents, multiplier }: PointsBracketProps) {
  return (
    <>
      [
      {percents.map((p, i) => (
        <span key={i} className={multiplier ? "points-boosted" : undefined} title={multiplier ? `${formatPercent(p)} × ${multiplier}` : undefined}>
          {i > 0 && (
            <>
              <wbr />/
            </>
          )}
          {formatPercent(multiplier ? boosted(p, multiplier) : p)}
        </span>
      ))}
      ]
    </>
  );
}

export default PointsBracket;
