import React, { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";
import { format } from "date-fns";

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-muted-foreground">{d?.label}</p>
      <p className={`text-sm font-mono font-bold ${d?.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
        {d?.pnl >= 0 ? "+" : ""}${Math.abs(d?.pnl ?? 0).toFixed(2)}
      </p>
      <p className="text-xs text-muted-foreground">{d?.count} trades</p>
    </div>
  );
};

export default function WinLossChart({ trades }) {
  const data = useMemo(() => {
    if (!trades?.length) return [];
    const grouped = {};
    trades.forEach(t => {
      const d = new Date(t.close_time || t.created_date);
      // Use a proper date key to avoid fraction-looking labels
      const key = format(d, "yyyy-MM-dd");
      const label = format(d, "MMM d");
      if (!grouped[key]) grouped[key] = { key, label, pnl: 0, count: 0 };
      grouped[key].pnl += (t.net_pnl || t.pnl || 0);
      grouped[key].count++;
    });
    return Object.values(grouped)
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-20);
  }, [trades]);

  if (!data.length) {
    return (
      <div className="bg-card rounded-xl border border-border p-6 flex items-center justify-center h-[260px]">
        <p className="text-muted-foreground text-sm">No trade data yet</p>
      </div>
    );
  }

  const totalPnl = data.reduce((s, d) => s + d.pnl, 0);

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Net Daily P&L</p>
          <p className={`text-2xl font-bold font-mono mt-0.5 ${totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {totalPnl >= 0 ? "+" : "-"}${Math.abs(totalPnl).toFixed(2)}
          </p>
        </div>
      </div>
      <div className="h-[200px] mt-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "hsl(215 20% 55%)" }}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "hsl(215 20% 55%)" }}
              tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0)}`}
              width={52}
            />
            <ReferenceLine y={0} stroke="hsl(215 28% 25%)" strokeDasharray="3 3" />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.pnl >= 0 ? "#34d399" : "#f87171"} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
