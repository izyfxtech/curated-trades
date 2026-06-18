import React from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-mono font-bold text-foreground">
        ${payload[0]?.value?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
      </p>
    </div>
  );
};

export default function EquityCurve({ trades, startingBalance = 0 }) {
  const data = React.useMemo(() => {
    if (!trades?.length) return [];
    const sorted = [...trades].sort((a, b) => new Date(a.close_time || a.created_at) - new Date(b.close_time || b.created_at));
    let balance = startingBalance;
    return sorted.map((t, i) => {
      balance += (t.net_pnl || t.pnl || 0);
      const d = new Date(t.close_time || t.created_at);
      return {
        name: format(d, "MMM d"),
        balance: Math.round(balance * 100) / 100,
        index: i,
      };
    });
  }, [trades, startingBalance]);

  if (!data.length) {
    return (
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Equity Curve</h3>
        <div className="h-[240px] flex items-center justify-center text-muted-foreground text-sm">
          No trade data yet
        </div>
      </div>
    );
  }

  const minBalance = Math.min(...data.map(d => d.balance));
  const maxBalance = Math.max(...data.map(d => d.balance));
  const isProfit = data[data.length - 1]?.balance > data[0]?.balance;

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-muted-foreground">Equity Curve</h3>
        <span className={`text-xs font-mono font-medium ${isProfit ? "text-emerald-400" : "text-red-400"}`}>
          ${data[data.length - 1]?.balance?.toLocaleString()}
        </span>
      </div>
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <defs>
              <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isProfit ? "#34d399" : "#f87171"} stopOpacity={0.3} />
                <stop offset="100%" stopColor={isProfit ? "#34d399" : "#f87171"} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis 
              dataKey="name" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 10, fill: "hsl(215 20% 55%)" }}
              interval="preserveStartEnd"
            />
            <YAxis 
              domain={[minBalance * 0.99, maxBalance * 1.01]} 
              axisLine={false} 
              tickLine={false}
              tick={{ fontSize: 10, fill: "hsl(215 20% 55%)" }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="balance"
              stroke={isProfit ? "#34d399" : "#f87171"}
              fill="url(#equityGrad)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
