import React, { useMemo } from "react";
import { Lock } from "lucide-react";

function Row({ label, value, valueClass = "text-foreground", locked = false }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      {locked ? (
        <div className="flex items-center gap-1.5">
          <Lock className="w-3 h-3 text-muted-foreground/40" />
          <span className="text-sm text-muted-foreground/40">···</span>
        </div>
      ) : (
        <span className={`text-sm font-mono font-medium ${valueClass}`}>{value}</span>
      )}
    </div>
  );
}

function Section({ title, icon, children }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-border">
        <span className="text-base">{icon}</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  );
}

export default function RiskStatsPanel({ trades, startingBalance = 10000 }) {
  const stats = useMemo(() => {
    if (!trades?.length) return null;

    const closedTrades = trades.filter(t => t.outcome !== "open");
    const pnls = closedTrades.map(t => t.net_pnl || t.pnl || 0);
    const totalPnl = pnls.reduce((s, p) => s + p, 0);
    const gainPct = startingBalance ? ((totalPnl / startingBalance) * 100) : 0;

    // Equity curve for drawdown calc
    let peak = startingBalance;
    let maxDrawdown = 0;
    let balance = startingBalance;
    const sorted = [...closedTrades].sort((a, b) => new Date(a.close_time || a.created_at) - new Date(b.close_time || b.created_at));
    sorted.forEach(t => {
      balance += (t.net_pnl || t.pnl || 0);
      if (balance > peak) peak = balance;
      const dd = peak - balance;
      if (dd > maxDrawdown) maxDrawdown = dd;
    });
    const maxDrawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : 0;

    const wins = closedTrades.filter(t => (t.pnl || 0) > 0);
    const losses = closedTrades.filter(t => (t.pnl || 0) < 0);
    const totalWin = wins.reduce((s, t) => s + (t.net_pnl || t.pnl || 0), 0);
    const totalLoss = Math.abs(losses.reduce((s, t) => s + (t.net_pnl || t.pnl || 0), 0));
    const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0;
    const expectancy = pnls.length ? totalPnl / pnls.length : 0;

    const pnlValues = pnls;
    const mean = pnlValues.length ? pnlValues.reduce((s, p) => s + p, 0) / pnlValues.length : 0;
    const variance = pnlValues.length ? pnlValues.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / pnlValues.length : 0;
    const stdDev = Math.sqrt(variance);
    const sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

    const totalLots = trades.reduce((s, t) => s + (t.lot_size || 0), 0);
    const totalCommission = trades.reduce((s, t) => s + (t.commission || 0), 0);
    const totalSwap = trades.reduce((s, t) => s + (t.swap || 0), 0);
    const currentBalance = startingBalance + totalPnl;

    return {
      gainPct, totalPnl, currentBalance, startingBalance,
      maxDrawdown, maxDrawdownPct,
      profitFactor, expectancy, stdDev, sharpe,
      winRate: closedTrades.length ? (wins.length / closedTrades.length) * 100 : 0,
      totalLots: totalLots.toFixed(2),
      totalCommission, totalSwap,
    };
  }, [trades, startingBalance]);

  const fmt = (v, decimals = 2) => {
    if (v === undefined || v === null) return "$0.00";
    const abs = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  };

  const pct = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
  const colorPos = "text-emerald-400";
  const colorNeg = "text-red-400";

  if (!stats) {
    return (
      <div className="bg-card rounded-xl border border-border p-6 flex items-center justify-center h-[300px]">
        <p className="text-muted-foreground text-sm">No trade data yet</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 pb-3 border-b border-border">
        <div>
          <p className="text-xs text-muted-foreground font-medium">Gain %</p>
          <p className={`text-2xl font-bold font-mono ${stats.gainPct >= 0 ? colorPos : colorNeg}`}>
            {pct(stats.gainPct)}
          </p>
          <p className={`text-xs font-mono ${stats.gainPct >= 0 ? colorPos : colorNeg}`}>
            {pct(stats.gainPct)} Abs
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground font-medium">NET P&L</p>
          <p className={`text-2xl font-bold font-mono ${stats.totalPnl >= 0 ? colorPos : colorNeg}`}>
            {fmt(stats.totalPnl)}
          </p>
        </div>
      </div>

      <Section title="Risk" icon="🛡">
        <Row label="Max Balance Drawdown" value={`${fmt(stats.maxDrawdown)} (${stats.maxDrawdownPct.toFixed(2)}%)`} valueClass={colorNeg} />
        <Row label="Max Equity Drawdown" locked />
        <Row label="Current Equity" value={fmt(stats.currentBalance)} />
        <Row label="Current Balance" value={fmt(stats.currentBalance)} />
        <Row label="Highest Balance" value={fmt(stats.startingBalance + Math.max(...(trades.map(t => t.pnl || 0)), 0))} />
      </Section>

      <Section title="Capital Flows" icon="💰">
        <Row label="Deposits / Withdrawals" value={`${fmt(stats.startingBalance)} / $0.00`} />
        <Row label="Commissions & Swap" value={`${fmt(-stats.totalCommission)} / ${fmt(-stats.totalSwap)}`} valueClass={colorNeg} />
        <Row label="Total Lots" value={stats.totalLots} />
      </Section>

      <Section title="Statistics" icon="📊">
        <Row label="Profit Factor" value={stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)} valueClass={stats.profitFactor >= 1 ? colorPos : colorNeg} />
        <Row label="Expectancy" value={fmt(stats.expectancy)} valueClass={stats.expectancy >= 0 ? colorPos : colorNeg} />
        <Row label="Standard Deviation" value={fmt(stats.stdDev)} />
        <Row label="Sharpe Ratio" value={stats.sharpe.toFixed(2)} valueClass={stats.sharpe >= 0 ? colorPos : colorNeg} />
      </Section>

      <Section title="Trade Stats" icon="📈">
        <Row label="Win Rate (%)" value={`${stats.winRate.toFixed(1)}%`} valueClass={stats.winRate >= 50 ? colorPos : colorNeg} />
        <Row label="Profit Factor" value={stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)} valueClass={stats.profitFactor >= 1 ? colorPos : colorNeg} />
      </Section>
    </div>
  );
}
