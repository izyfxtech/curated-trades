import React, { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-muted-foreground capitalize">{d?.session}</p>
      <p className="text-sm font-mono font-bold text-foreground">{d?.trades} trades</p>
      <p className={`text-xs font-mono ${d?.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
        {d?.pnl >= 0 ? "+" : ""}${d?.pnl?.toFixed(2)} | {d?.winRate?.toFixed(0)}% WR
      </p>
    </div>
  );
};

export default function SessionAnalysis({ trades }) {
  const data = useMemo(() => {
    const sessions = { asian: [], london: [], new_york: [], overlap: [] };
    trades.forEach(t => {
      if (t.session && sessions[t.session]) sessions[t.session].push(t);
    });
    return Object.entries(sessions).map(([session, sessionTrades]) => {
      const wins = sessionTrades.filter(t => (t.pnl || 0) > 0).length;
      return {
        session: session.replace("_", " "),
        trades: sessionTrades.length,
        pnl: sessionTrades.reduce((s, t) => s + (t.pnl || 0), 0),
        winRate: sessionTrades.length ? (wins / sessionTrades.length) * 100 : 0,
      };
    }).filter(d => d.trades > 0);
  }, [trades]);

  if (!data.length) {
    return (
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Session Analysis</h3>
        <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
          Tag trades with sessions to see analysis
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Session Performance</h3>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 5, bottom: 5, left: 60 }}>
            <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "hsl(215 20% 55%)" }} />
            <YAxis type="category" dataKey="session" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(215 20% 55%)", textTransform: "capitalize" }} width={70} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.pnl >= 0 ? "#34d399" : "#f87171"} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
