// The header over one part of a list a sort has split up (see SortOption.parts): its words — in its own
// colour, where it has one — how many rows it holds, and a rule out to the list's edge. It sits between
// the part's lists, on their grid.

interface ListPartHeadProps {
  label: string;
  count: number;
  color?: string;
}

export default function ListPartHead({ label, count, color }: ListPartHeadProps) {
  return (
    <div className="list-part-head" style={color ? ({ "--c": color } as React.CSSProperties) : undefined}>
      <span className="list-part-label">{label}</span>
      <span className="list-part-count">{count}</span>
      <span className="list-part-rule" aria-hidden="true" />
    </div>
  );
}
