// Hand-rolled R-multiple histogram (no charting library dependency — the
// project doesn't have one, and adding recharts/d3 for one histogram felt
// like more weight than this needed; see StreakDistributionCard.tsx for the
// same approach applied to streak lengths). Bucket edges are fixed in
// lib/analytics.ts (computeRDistribution); this component only renders them.
import type { RBucket } from "@/lib/analytics";

export function RDistributionChart({ buckets }: { buckets: RBucket[] }) {
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((sum, b) => sum + b.count, 0);

  return (
    <div className="surface-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Distribution</p>
          <h2 className="panel-title">R-multiple spread</h2>
        </div>
      </div>
      {total === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No R-multiple data in this range yet.</p>
      ) : (
        <div className="flex h-40 items-end gap-2">
          {buckets.map((bucket, index) => {
            const heightPercent = Math.max(2, (bucket.count / maxCount) * 100);
            // First 3 buckets are <-2R, -2 to -1R, -1 to 0R — the negative
            // and roughly-breakeven-or-worse side of the distribution.
            const isNegative = index < 3;
            return (
              <div key={bucket.label} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="font-mono text-xs text-muted-foreground">{bucket.count}</span>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={`w-full rounded-t-sm ${isNegative ? "bg-destructive" : "bg-chart-2"}`}
                    style={{ height: `${heightPercent}%` }}
                  />
                </div>
                <span className="text-center text-[10px] leading-tight text-muted-foreground">{bucket.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
