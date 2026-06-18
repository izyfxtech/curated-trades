import React, { useMemo } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export default function CalendarTopSymbols({ trades, currentMonth }) {
  const data = useMemo(() => {
    const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    const monthTrades = trades.filter(t => {
      const d = t.close_time || t.created_at;
      if (!d) return false;
      const date = new Date(d);
      return date >= start && date <= end;
    });
    const map = {};
    monthTrades.forEach(t => {
      const sym = t.symbol || "Unknown";
      if (!map[sym]) map[sym] = { symbol: sym, trades: 0, pnl: 0, wins: 0 };
      map[sym].trades++;
      map[sym].pnl += t.net_pnl || t.pnl || 0;
      if ((t.pnl || 0) > 0) map[sym].wins++;
    });
    return Object.values(map).sort((a, b) => b.trades - a.trades).slice(0, 6);
  }, [trades, currentMonth]);

  if (!data.length) return null;

  const maxTrades = data[0]?.trades || 1;

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Top Symbols This Month</h3>
      <div className="space-y-3">
        {data.map((sym, i) => (
          <div key={sym.symbol} className="flex items-center gap-3">
            <span className="w-16 text-xs font-mono font-semibold text-foreground truncate">{sym.symbol}</span>
            <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full", sym.pnl >= 0 ? "bg-emerald-400" : "bg-red-400")}
                style={{ width: `${(sym.trades / maxTrades) * 100}%`, opacity: 0.8 }}
              />
            </div>
            <span className="w-8 text-xs text-muted-foreground text-right">{sym.trades}t</span>
            <span className={cn("w-16 text-xs font-mono text-right", sym.pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
              {sym.pnl >= 0 ? "+" : "-"}${Math.abs(sym.pnl).toFixed(0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
