import React, { useMemo, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { format } from "date-fns";

const PERIODS = ["1W", "1M", "3M", "6M", "All"];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-mono font-bold ${val >= 0 ? "text-emerald-400" : "text-red-400"}`}>
        {val >= 0 ? "+" : ""}{val?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
    </div>
  );
};

export default function ProfitChart({ trades }) {
  const [period, setPeriod] = useState("All");

  const { data, totalPnl } = useMemo(() => {
    if (!trades?.length) return { data: [], totalPnl: 0 };

    const now = new Date();
    const cutoffs = { "1W": 7, "1M": 30, "3M": 90, "6M": 180 };
    const days = cutoffs[period];

    let filtered = [...trades].filter(t => t.close_time || t.created_at);
    if (days) {
      const cutoff = new Date(now.getTime() - days * 86400000);
      filtered = filtered.filter(t => new Date(t.close_time || t.created_at) >= cutoff);
    }
    filtered.sort((a, b) => new Date(a.close_time || a.created_at) - new Date(b.close_time || b.created_at));

    let cumulative = 0;
    const points = filtered.map(t => {
      cumulative += t.net_pnl || t.pnl || 0;
      const d = new Date(t.close_time || t.created_at);
      return {
        name: format(d, "MMM d"),
        profit: Math.round(cumulative * 100) / 100,
        date: d,
      };
    });

    return { data: points, totalPnl: cumulative };
  }, [trades, period]);

  const isProfit = totalPnl >= 0;

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Profit</p>
          <p className={`text-3xl font-bold font-mono ${isProfit ? "text-emerald-400" : "text-red-400"}`}>
            {isProfit ? "+" : ""}{totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                period === p
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No data for period</div>
      ) : (
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 10 }}>
              <defs>
                <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={isProfit ? "#10b981" : "#ef4444"} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={isProfit ? "#10b981" : "#ef4444"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "hsl(215 20% 45%)" }} interval="preserveStartEnd" />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "hsl(215 20% 45%)" }} tickFormatter={v => v.toFixed(0)} width={55} />
              <ReferenceLine y={0} stroke="hsl(215 28% 25%)" strokeDasharray="3 3" />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="profit" stroke={isProfit ? "#10b981" : "#ef4444"} fill="url(#profitGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
