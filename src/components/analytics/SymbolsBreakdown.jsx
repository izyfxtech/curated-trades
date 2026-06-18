import React, { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899"];

export default function SymbolsBreakdown({ trades }) {
  const { data, totalTrades, symbolCount } = useMemo(() => {
    if (!trades?.length) return { data: [], totalTrades: 0, symbolCount: 0 };
    const map = {};
    trades.forEach(t => {
      const sym = t.symbol || "Unknown";
      if (!map[sym]) map[sym] = { symbol: sym, count: 0, pnl: 0 };
      map[sym].count++;
      map[sym].pnl += t.net_pnl || t.pnl || 0;
    });
    const sorted = Object.values(map).sort((a, b) => b.count - a.count);
    return { data: sorted, totalTrades: trades.length, symbolCount: sorted.length };
  }, [trades]);

  if (!data.length) {
    return (
      <div className="bg-card rounded-xl border border-border p-6 flex items-center justify-center h-[300px]">
        <p className="text-muted-foreground text-sm">No trade data yet</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Symbols Traded</p>
          <p className="text-3xl font-bold font-mono text-foreground">{symbolCount}</p>
        </div>
      </div>

      <div className="relative h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              dataKey="count"
              paddingAngle={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="transparent" />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
                    <p className="font-bold text-foreground">{d.symbol}</p>
                    <p className="text-muted-foreground">{d.count} trades ({((d.count / totalTrades) * 100).toFixed(0)}%)</p>
                    <p className={d.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                      P&L: {d.pnl >= 0 ? "+" : ""}{d.pnl.toFixed(2)}
                    </p>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold font-mono text-foreground">{totalTrades}</span>
          <span className="text-xs text-muted-foreground">Trades</span>
        </div>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-1.5 mt-4">
        {data.slice(0, 6).map((d, i) => (
          <div key={d.symbol} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="text-xs font-mono text-muted-foreground truncate">{d.symbol}</span>
            <span className="text-xs text-muted-foreground ml-auto">{d.count}</span>
            <span className="text-xs text-muted-foreground">{((d.count / totalTrades) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
