import React, { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-sm font-medium text-foreground">{payload[0]?.name}</p>
      <p className="text-xs text-muted-foreground">{payload[0]?.value} trades</p>
    </div>
  );
};

export default function WinLossDistribution({ trades }) {
  const data = useMemo(() => {
    const wins = trades.filter(t => (t.pnl || 0) > 0).length;
    const losses = trades.filter(t => (t.pnl || 0) < 0).length;
    const breakevens = trades.filter(t => (t.pnl || 0) === 0).length;
    return [
      { name: "Wins", value: wins, color: "#34d399" },
      { name: "Losses", value: losses, color: "#f87171" },
      { name: "Breakeven", value: breakevens, color: "#64748b" },
    ].filter(d => d.value > 0);
  }, [trades]);

  if (!data.length) {
    return (
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Win/Loss Distribution</h3>
        <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Win/Loss Distribution</h3>
      <div className="flex items-center gap-6">
        <div className="h-[180px] w-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-3">
          {data.map((d) => (
            <div key={d.name} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
              <span className="text-sm text-muted-foreground">{d.name}</span>
              <span className="text-sm font-mono font-semibold text-foreground">{d.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
