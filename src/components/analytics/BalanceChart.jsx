import React, { useMemo, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";

const PERIODS = ["1W", "1M", "3M", "6M", "All"];
// startingBalance is passed from context — no more hardcoding

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-mono font-bold text-foreground">
        ${val?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
    </div>
  );
};

export default function BalanceChart({ trades, startingBalance = 0 }) {
  const [period, setPeriod] = useState("All");

  const { data, currentBalance, changePct } = useMemo(() => {
    if (!trades?.length) return { data: [], currentBalance: startingBalance, changePct: 0 };

    const now = new Date();
    const cutoffs = { "1W": 7, "1M": 30, "3M": 90, "6M": 180 };
    const days = cutoffs[period];

    let filtered = [...trades].filter(t => t.close_time || t.created_at);
    filtered.sort((a, b) => new Date(a.close_time || a.created_at) - new Date(b.close_time || b.created_at));

    let balance = startingBalance;
    const allPoints = filtered.map(t => {
      balance += t.net_pnl || t.pnl || 0;
      return { date: new Date(t.close_time || t.created_at), balance: Math.round(balance * 100) / 100 };
    });

    let points = allPoints;
    if (days) {
      const cutoff = new Date(now.getTime() - days * 86400000);
      points = allPoints.filter(p => p.date >= cutoff);
    }

    const labeled = points.map(p => ({ name: format(p.date, "MMM d"), balance: p.balance }));
    const final = labeled[labeled.length - 1]?.balance ?? startingBalance;
    const base = startingBalance > 0 ? startingBalance : 1;
    const pct = ((final - startingBalance) / base) * 100;
    return { data: labeled, currentBalance: final, changePct: pct };
  }, [trades, period, startingBalance]);

  const isProfit = changePct >= 0;

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Balance</p>
            <span className={`text-xs px-2 py-0.5 rounded font-mono font-medium ${isProfit ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
              {isProfit ? "+" : ""}{changePct.toFixed(2)}%
            </span>
          </div>
          <p className="text-3xl font-bold font-mono text-foreground">
            ${currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
                <linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "hsl(215 20% 45%)" }} interval="preserveStartEnd" />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "hsl(215 20% 45%)" }} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} width={55} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="balance" stroke="#3b82f6" fill="url(#balanceGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
