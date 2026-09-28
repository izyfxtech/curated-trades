// Dimension-switchable performance breakdown (setup, symbol, session, day of
// week, emotion, mistake, etc.) with inline drill-down. Clicking a group
// expands it in place to show the underlying trades; clicking one of those
// trade rows deep-links to Journal with that trade's edit modal open
// (?trade=<id> — see journal.tsx), the same mechanism the equity curve and
// P&L heatmap use, so "show me that trade" always means the same thing
// wherever you click it from. All the actual grouping/stats math lives in
// lib/analytics.ts — this component only renders what it's given.
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BREAKDOWN_DIMENSIONS, type BreakdownDimension, type BreakdownGroup } from "@/lib/analytics";

export function BreakdownExplorer({
  dimension,
  onDimensionChange,
  groups,
  minSampleSize,
}: {
  dimension: BreakdownDimension;
  onDimensionChange: (dimension: BreakdownDimension) => void;
  groups: BreakdownGroup[];
  minSampleSize: number;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const navigate = useNavigate();
  const maxAbsNetPnl = Math.max(1, ...groups.map((g) => Math.abs(g.stats.netPnl)));

  return (
    <div className="surface-panel">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Breakdown</p>
          <h2 className="panel-title">Performance by dimension</h2>
        </div>
        <Select value={dimension} onValueChange={(v: BreakdownDimension) => onDimensionChange(v)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BREAKDOWN_DIMENSIONS.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No groups with at least {minSampleSize} trades yet — lower the minimum sample size or log more trades.
        </p>
      ) : (
        <div className="space-y-1">
          {groups.map((group) => {
            const isExpanded = expandedKey === group.key;
            const barWidth = Math.max(2, (Math.abs(group.stats.netPnl) / maxAbsNetPnl) * 100);
            const positive = group.stats.netPnl >= 0;
            return (
              <div key={group.key} className="rounded-md border border-transparent hover:border-border">
                <button
                  type="button"
                  className="grid w-full grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => setExpandedKey(isExpanded ? null : group.key)}
                >
                  {isExpanded ? (
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                  )}
                  <span className="col-start-2 min-w-[9rem] font-medium">{group.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">{group.stats.tradeCount} trades</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {group.stats.winRate != null ? `${group.stats.winRate}% win` : "—"}
                  </span>
                  <span className={`font-mono font-semibold ${positive ? "text-chart-2" : "text-destructive"}`}>
                    ${group.stats.netPnl.toFixed(0)}
                  </span>
                </button>
                <div className="col-span-full ml-6 mr-2 h-1.5 overflow-hidden rounded-sm bg-muted">
                  <div
                    className={`h-full ${positive ? "bg-chart-2" : "bg-destructive"}`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>

                {isExpanded && (
                  <div className="mb-2 ml-6 mr-2 mt-2 overflow-hidden rounded-md border border-border">
                    <table className="trade-table">
                      <thead>
                        <tr>
                          <th>Symbol</th>
                          <th>Closed</th>
                          <th>R</th>
                          <th>Net P&L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.trades.slice(0, 20).map((trade) => (
                          <tr
                            key={trade.id}
                            className="cursor-pointer hover:bg-secondary"
                            onClick={() => void navigate({ to: "/app/journal/$tradeId", params: { tradeId: trade.id } })}
                          >
                            <td className="font-medium">{trade.symbol}</td>
                            <td className="font-mono text-xs text-muted-foreground">
                              {trade.closed_at ? new Date(trade.closed_at).toLocaleDateString() : "—"}
                            </td>
                            <td className="font-mono">
                              {trade.realized_r_multiple != null ? `${trade.realized_r_multiple.toFixed(2)}R` : "—"}
                            </td>
                            <td
                              className={`font-mono font-semibold ${(trade.net_pnl ?? 0) >= 0 ? "text-chart-2" : "text-destructive"}`}
                            >
                              ${(trade.net_pnl ?? 0).toFixed(0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {group.trades.length > 20 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        +{group.trades.length - 20} more — open Journal to see the rest.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
