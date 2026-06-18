import React, { useMemo } from "react";
import { format } from "date-fns";
import { TrendingUp, TrendingDown, Calendar, Zap, Target, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";

function StatTile({ label, value, sub, color = "text-foreground", icon: Icon, bg = "bg-secondary/40" }) {
  return (
    <div className={cn("rounded-xl border border-border p-4 bg-card", bg)}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {Icon && (
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-3.5 h-3.5 text-primary" />
          </div>
        )}
      </div>
      <p className={cn("text-xl font-bold font-mono", color)}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export default function CalendarMonthStats({ trades, currentMonth }) {
  const stats = useMemo(() => {
    const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

    const monthTrades = trades.filter(t => {
      const d = t.close_time || t.created_date;
      if (!d) return false;
      const date = new Date(d);
      return date >= start && date <= end;
    });

    if (!monthTrades.length) return null;

    // Group by day
    const byDay = {};
    monthTrades.forEach(t => {
      const key = format(new Date(t.close_time || t.created_date), "yyyy-MM-dd");
      if (!byDay[key]) byDay[key] = { pnl: 0, trades: 0 };
      byDay[key].pnl += t.net_pnl || t.pnl || 0;
      byDay[key].trades++;
    });

    const days = Object.values(byDay);
    const activeDays = days.length;
    const winDays = days.filter(d => d.pnl > 0).length;
    const lossDays = days.filter(d => d.pnl < 0).length;
    const totalPnl = monthTrades.reduce((s, t) => s + (t.net_pnl || t.pnl || 0), 0);

    const dayPnls = Object.entries(byDay).map(([date, d]) => ({ date, pnl: d.pnl }));
    const bestDay = dayPnls.reduce((best, d) => d.pnl > best.pnl ? d : best, dayPnls[0]);
    const worstDay = dayPnls.reduce((worst, d) => d.pnl < worst.pnl ? d : worst, dayPnls[0]);

    // Win streak
    const sortedDays = dayPnls.sort((a, b) => new Date(a.date) - new Date(b.date));
    let maxStreak = 0, cur = 0;
    sortedDays.forEach(d => { if (d.pnl > 0) { cur++; if (cur > maxStreak) maxStreak = cur; } else { cur = 0; } });

    const wins = monthTrades.filter(t => (t.pnl || 0) > 0);
    const winRate = monthTrades.length ? (wins.length / monthTrades.length) * 100 : 0;
    const avgTrades = activeDays ? (monthTrades.length / activeDays).toFixed(1) : 0;

    return {
      totalPnl, activeDays, winDays, lossDays,
      bestDay: { date: bestDay?.date, pnl: bestDay?.pnl ?? 0 },
      worstDay: { date: worstDay?.date, pnl: worstDay?.pnl ?? 0 },
      maxStreak, winRate, totalTrades: monthTrades.length, avgTrades,
    };
  }, [trades, currentMonth]);

  const fmt = (v) => {
    const abs = Math.abs(v);
    const sign = v >= 0 ? "+" : "-";
    return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  if (!stats) {
    return (
      <div className="bg-card rounded-xl border border-border p-6 flex items-center justify-center h-40">
        <p className="text-sm text-muted-foreground">No trades this month</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top row: 3 stat tiles */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile
          label="Month P&L"
          value={fmt(stats.totalPnl)}
          sub={`${stats.totalTrades} trades`}
          color={stats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}
          icon={DollarSignIcon}
        />
        <StatTile
          label="Win Rate"
          value={`${stats.winRate.toFixed(0)}%`}
          sub={`${stats.winDays}W · ${stats.lossDays}L days`}
          color={stats.winRate >= 50 ? "text-emerald-400" : "text-red-400"}
          icon={Target}
        />
        <StatTile
          label="Max Streak"
          value={`${stats.maxStreak} wins`}
          sub={`${stats.activeDays} active days`}
          color="text-primary"
          icon={Zap}
        />
      </div>
      {/* Bottom row */}
      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="Best Day"
          value={fmt(stats.bestDay.pnl)}
          sub={stats.bestDay.date ? format(new Date(stats.bestDay.date), "MMM d") : "—"}
          color="text-emerald-400"
          icon={TrendingUp}
        />
        <StatTile
          label="Worst Day"
          value={fmt(stats.worstDay.pnl)}
          sub={stats.worstDay.date ? format(new Date(stats.worstDay.date), "MMM d") : "—"}
          color="text-red-400"
          icon={TrendingDown}
        />
      </div>
    </div>
  );
}

function DollarSignIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}
