// Histogram of every win/loss streak length in the closed-trade history —
// distinct from the "current streak" shown on the dashboard, which only
// tracks the streak in progress right now. See computeStreakDistribution in
// lib/analytics.ts for how streaks are segmented (a breakeven trade, net
// P&L exactly 0, ends whatever streak was in progress without starting one
// of its own).
import type { StreakDistribution as StreakDistributionData } from "@/lib/analytics";

function tally(streaks: number[]): { length: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const length of streaks) {
    counts.set(length, (counts.get(length) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([length, count]) => ({ length, count }))
    .sort((a, b) => a.length - b.length);
}

function StreakRow({ length, count, maxCount, tone }: { length: number; count: number; maxCount: number; tone: "win" | "loss" }) {
  const widthPercent = Math.max(4, (count / maxCount) * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-10 shrink-0 font-mono text-muted-foreground">{length}x</span>
      <div className="h-2 flex-1 overflow-hidden rounded-sm bg-muted">
        <div className={`h-full ${tone === "win" ? "bg-chart-2" : "bg-destructive"}`} style={{ width: `${widthPercent}%` }} />
      </div>
      <span className="w-6 shrink-0 text-right font-mono text-muted-foreground">{count}</span>
    </div>
  );
}

export function StreakDistributionCard({ distribution }: { distribution: StreakDistributionData }) {
  const winTally = tally(distribution.winStreaks);
  const lossTally = tally(distribution.lossStreaks);
  const maxCount = Math.max(1, ...winTally.map((t) => t.count), ...lossTally.map((t) => t.count));
  const longestWin = distribution.winStreaks.length > 0 ? Math.max(...distribution.winStreaks) : null;
  const longestLoss = distribution.lossStreaks.length > 0 ? Math.max(...distribution.lossStreaks) : null;

  return (
    <div className="surface-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Consistency</p>
          <h2 className="panel-title">Streak distribution</h2>
        </div>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs text-muted-foreground">
            Win streaks {longestWin != null && <span className="font-mono">(longest {longestWin})</span>}
          </p>
          {winTally.length === 0 ? (
            <p className="text-xs text-muted-foreground">No wins in this range yet.</p>
          ) : (
            <div className="space-y-1.5">
              {winTally.map((t) => (
                <StreakRow key={t.length} length={t.length} count={t.count} maxCount={maxCount} tone="win" />
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="mb-2 text-xs text-muted-foreground">
            Loss streaks {longestLoss != null && <span className="font-mono">(longest {longestLoss})</span>}
          </p>
          {lossTally.length === 0 ? (
            <p className="text-xs text-muted-foreground">No losses in this range yet.</p>
          ) : (
            <div className="space-y-1.5">
              {lossTally.map((t) => (
                <StreakRow key={t.length} length={t.length} count={t.count} maxCount={maxCount} tone="loss" />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
