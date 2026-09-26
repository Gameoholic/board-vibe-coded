import { formatPercent } from "@board/contracts";

interface PointsBracketProps {
  // Point values as integer thousandths-of-a-percent (see @board/contracts points.ts).
  percents: number[];
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
function PointsBracket({ percents }: PointsBracketProps) {
  return (
    <>
      [
      {percents.map((p, i) => (
        <span key={i}>
          {i > 0 && (
            <>
              <wbr />/
            </>
          )}
          {formatPercent(p)}
        </span>
      ))}
      ]
    </>
  );
}

export default PointsBracket;
