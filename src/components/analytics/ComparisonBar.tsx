// One row: a label, then two bars scaled against each other (not against a
// fixed 0-100 axis — the point is comparing the two values to each other,
// not to an absolute scale). Used for the ratio-metrics comparisons
// (planned vs. realized R, avg winner vs. loser) and for every row of the
// Curated vs. Impulse panel, so both places read as one visual comparison
// instead of two numbers you have to mentally diff yourself.
export interface ComparisonBarSide {
  label: string;
  value: number;
  display: string;
  tone?: "positive" | "negative" | "neutral";
}

export interface ComparisonBarProps {
  label: string;
  left: ComparisonBarSide;
  right: ComparisonBarSide;
}

const TONE_CLASS: Record<NonNullable<ComparisonBarSide["tone"]>, string> = {
  positive: "progress-fill",
  negative: "progress-fill progress-danger",
  neutral: "progress-fill progress-warm",
};

function Bar({ side, maxAbs }: { side: ComparisonBarSide; maxAbs: number }) {
  const width = maxAbs > 0 ? Math.max(2, (Math.abs(side.value) / maxAbs) * 100) : 2;
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{side.label}</span>
      <div className="progress-track mt-0 flex-1">
        <span className={TONE_CLASS[side.tone ?? "neutral"]} style={{ width: `${width}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right font-mono text-xs font-medium">{side.display}</span>
    </div>
  );
}

export function ComparisonBar({ label, left, right }: ComparisonBarProps) {
  const maxAbs = Math.max(Math.abs(left.value), Math.abs(right.value), 1);
  return (
    <div>
      <p className="field-label mb-2">{label}</p>
      <div className="space-y-1.5">
        <Bar side={left} maxAbs={maxAbs} />
        <Bar side={right} maxAbs={maxAbs} />
      </div>
    </div>
  );
}
