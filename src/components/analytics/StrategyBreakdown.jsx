import React, { useMemo } from "react";
import { cn } from "@/lib/utils";

export default function StrategyBreakdown({ trades }) {
  const strategies = useMemo(() => {
    const grouped = {};
    trades.forEach(t => {
      const strat = t.strategy || "No Strategy";
      if (!grouped[strat]) grouped[strat] = [];
      grouped[strat].push(t);
    });
    return Object.entries(grouped).map(([name, stratTrades]) => {
      const wins = stratTrades.filter(t => (t.pnl || 0) > 0);
      const totalPnl = stratTrades.reduce((s, t) => s + (t.pnl || 0), 0);
      return {
        name,
        trades: stratTrades.length,
        wins: wins.length,
        losses: stratTrades.length - wins.length,
        winRate: (wins.length / stratTrades.length) * 100,
        pnl: totalPnl,
        avgPnl: totalPnl / stratTrades.length,
      };
    }).sort((a, b) => b.pnl - a.pnl);
  }, [trades]);

  if (!strategies.length) return null;

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Strategy Breakdown</h3>
      <div className="space-y-3">
        {strategies.map((strat) => (
          <div key={strat.name} className="flex items-center justify-between py-3 px-4 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <span className="text-sm font-bold text-primary">{strat.name[0]?.toUpperCase()}</span>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{strat.name}</p>
                <p className="text-xs text-muted-foreground">{strat.trades} trades · {strat.winRate.toFixed(0)}% WR</p>
              </div>
            </div>
            <div className="text-right">
              <p className={cn(
                "text-sm font-mono font-semibold",
                strat.pnl >= 0 ? "text-emerald-400" : "text-red-400"
              )}>
                {strat.pnl >= 0 ? "+" : "-"}${Math.abs(strat.pnl).toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground">Avg: {strat.avgPnl >= 0 ? "+" : "-"}${Math.abs(strat.avgPnl).toFixed(2)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
