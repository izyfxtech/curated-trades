import { Link } from "@tanstack/react-router";

import type { BreakdownGroup } from "@/lib/analytics";
import { formatSignedMoney } from "@/lib/money";

const SESSION_ORDER = ["Asia", "London", "New York"];

export function SessionBreakdownPanel({ groups, currency = "USD" }: { groups: BreakdownGroup[]; currency?: string }) {
  const ordered = [...groups].sort((a, b) => {
    const ai = SESSION_ORDER.indexOf(a.key);
    const bi = SESSION_ORDER.indexOf(b.key);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const maxAbsPnl = Math.max(1, ...ordered.map((g) => Math.abs(g.stats.netPnl)));

  return (
    <div className="surface-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Forex session</p>
          <h2 className="panel-title">P&amp;L by session</h2>
        </div>
        <Link to="/app/journal" className="text-xs text-muted-foreground hover:text-foreground">
          Open journal
        </Link>
      </div>
      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Not enough closed trades yet.</p>
      ) : (
        <div className="space-y-3">
          {ordered.map((group) => {
            const positive = group.stats.netPnl >= 0;
            const width = Math.max(2, (Math.abs(group.stats.netPnl) / maxAbsPnl) * 100);
            return (
              <div key={group.key} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-sm">{group.label}</span>
                <div className="progress-track mt-0 flex-1">
                  <span className={positive ? "progress-fill" : "progress-fill progress-danger"} style={{ width: `${width}%` }} />
                </div>
                <span className={`w-20 shrink-0 text-right font-mono text-xs font-medium ${positive ? "text-chart-2" : "text-destructive"}`}>
                  {formatSignedMoney(group.stats.netPnl, currency)}
                </span>
                <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                  {group.trades.length} trade{group.trades.length === 1 ? "" : "s"}, {group.stats.winRate ?? 0}% win
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
