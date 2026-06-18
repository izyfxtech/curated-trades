import React from "react";
import { TrendingUp, TrendingDown, BarChart2, Target, Zap, DollarSign, List, Calendar, Activity, Clock, PieChart, Users } from "lucide-react";

// Tiny sparkline-style bar chart preview
function MiniBar({ values, color }) {
  const max = Math.max(...values.map(Math.abs));
  return (
    <div className="flex items-end gap-0.5 h-8">
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm opacity-80"
          style={{
            height: `${(Math.abs(v) / max) * 100}%`,
            backgroundColor: v >= 0 ? "#34d399" : "#f87171",
            minHeight: 2,
          }}
        />
      ))}
    </div>
  );
}

function MiniLine({ values, color = "#3b82f6" }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 100, h = 32;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={color} opacity="0.15" />
    </svg>
  );
}

function MiniPie({ slices }) {
  let cumAngle = -90;
  const cx = 16, cy = 16, r = 13;
  const paths = slices.map(({ pct, color }) => {
    const angle = pct * 360;
    const startRad = (cumAngle * Math.PI) / 180;
    cumAngle += angle;
    const endRad = (cumAngle * Math.PI) / 180;
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    const large = angle > 180 ? 1 : 0;
    return { d: `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`, color };
  });
  return (
    <svg viewBox="0 0 32 32" className="w-8 h-8">
      {paths.map((p, i) => <path key={i} d={p.d} fill={p.color} />)}
      <circle cx={cx} cy={cy} r={7} fill="hsl(var(--card))" />
    </svg>
  );
}

const STAT_DEMO = {
  stat_pnl:      { icon: DollarSign, label: "Net P&L",       value: "+$1,240", color: "text-emerald-400", bg: "bg-emerald-500/10" },
  stat_winrate:  { icon: Target,     label: "Win Rate",       value: "67.3%",   color: "text-primary",     bg: "bg-primary/10" },
  stat_trades:   { icon: BarChart2,  label: "Total Trades",   value: "48",      color: "text-foreground",  bg: "bg-secondary/60" },
  stat_factor:   { icon: TrendingUp, label: "Profit Factor",  value: "2.14",    color: "text-emerald-400", bg: "bg-emerald-500/10" },
  stat_expectancy:{ icon: Zap,       label: "Expectancy",     value: "+$25.8",  color: "text-emerald-400", bg: "bg-emerald-500/10" },
  stat_avgwin:   { icon: TrendingUp, label: "Avg Win",        value: "+$84",    color: "text-emerald-400", bg: "bg-emerald-500/10" },
  stat_avgloss:  { icon: TrendingDown,label: "Avg Loss",      value: "-$39",    color: "text-red-400",     bg: "bg-red-500/10" },
  stat_beststrade:{ icon: Zap,       label: "Best Trade",     value: "+$312",   color: "text-emerald-400", bg: "bg-emerald-500/10" },
  stat_worstrade:{ icon: Activity,   label: "Worst Trade",    value: "-$145",   color: "text-red-400",     bg: "bg-red-500/10" },
  stat_avgrr:    { icon: Target,     label: "Avg R:R",        value: "1.85",    color: "text-primary",     bg: "bg-primary/10" },
  stat_month_pnl:{ icon: DollarSign, label: "Month P&L",      value: "+$640",   color: "text-emerald-400", bg: "bg-emerald-500/10" },
  stat_streak:   { icon: Zap,        label: "Win Streak",     value: "5 wins",  color: "text-emerald-400", bg: "bg-emerald-500/10" },
  stat_best_day: { icon: TrendingUp, label: "Best Day",       value: "+$430",   color: "text-emerald-400", bg: "bg-emerald-500/10" },
  stat_worst_day:{ icon: TrendingDown,label:"Worst Day",      value: "-$210",   color: "text-red-400",     bg: "bg-red-500/10" },
  stat_active_days:{ icon: Calendar, label: "Active Days",    value: "18",      color: "text-foreground",  bg: "bg-secondary/60" },
};

export default function WidgetPreview({ id }) {
  // Stat card preview
  if (STAT_DEMO[id]) {
    const { icon: Icon, label, value, color, bg } = STAT_DEMO[id];
    return (
      <div className="w-full bg-secondary/30 rounded-lg p-2.5 border border-border/50">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</span>
          <div className={`w-5 h-5 rounded ${bg} flex items-center justify-center`}>
            <Icon className={`w-2.5 h-2.5 ${color}`} />
          </div>
        </div>
        <span className={`text-sm font-bold font-mono ${color}`}>{value}</span>
      </div>
    );
  }

  // Chart previews
  const barData = [12, -5, 18, -8, 25, 10, -3, 15, 22, -6, 30, 8];
  const lineData = [10000, 10200, 10150, 10400, 10350, 10600, 10800, 10750, 11000, 11200];
  const profitLine = [0, 200, 150, 400, 350, 600, 800, 750, 1000, 1200];

  if (id === "equity_curve" || id === "balance_chart") {
    return (
      <div className="w-full bg-secondary/30 rounded-lg p-2 border border-border/50">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] text-muted-foreground">{id === "balance_chart" ? "Balance" : "Equity"}</span>
          <span className="text-[9px] font-mono text-emerald-400">+12.0%</span>
        </div>
        <MiniLine values={lineData} color="#3b82f6" />
      </div>
    );
  }

  if (id === "profit_chart") {
    return (
      <div className="w-full bg-secondary/30 rounded-lg p-2 border border-border/50">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] text-muted-foreground">Cumulative P&L</span>
          <span className="text-[9px] font-mono text-emerald-400">+$1,200</span>
        </div>
        <MiniLine values={profitLine} color="#10b981" />
      </div>
    );
  }

  if (id === "win_loss_chart" || id === "daily_pnl") {
    return (
      <div className="w-full bg-secondary/30 rounded-lg p-2 border border-border/50">
        <div className="mb-1"><span className="text-[9px] text-muted-foreground">Daily P&L</span></div>
        <MiniBar values={barData} />
      </div>
    );
  }

  if (id === "win_loss_dist") {
    return (
      <div className="w-full bg-secondary/30 rounded-lg p-2 border border-border/50 flex items-center gap-2">
        <MiniPie slices={[{ pct: 0.67, color: "#34d399" }, { pct: 0.27, color: "#f87171" }, { pct: 0.06, color: "#64748b" }]} />
        <div className="space-y-0.5">
          <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400" /><span className="text-[9px] text-muted-foreground">67% Wins</span></div>
          <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-red-400" /><span className="text-[9px] text-muted-foreground">27% Loss</span></div>
        </div>
      </div>
    );
  }

  if (id === "session_analysis") {
    return (
      <div className="w-full bg-secondary/30 rounded-lg p-2 border border-border/50">
        <div className="mb-1"><span className="text-[9px] text-muted-foreground">By Session</span></div>
        <div className="space-y-1">
          {[{ s: "London", v: 0.8, c: "#34d399" }, { s: "NY", v: 0.6, c: "#3b82f6" }, { s: "Asian", v: 0.3, c: "#f59e0b" }].map(r => (
            <div key={r.s} className="flex items-center gap-1.5">
              <span className="text-[8px] text-muted-foreground w-10">{r.s}</span>
              <div className="flex-1 h-1.5 bg-secondary rounded-full"><div className="h-full rounded-full" style={{ width: `${r.v * 100}%`, backgroundColor: r.c }} /></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (id === "strategy_breakdown") {
    return (
      <div className="w-full bg-secondary/30 rounded-lg p-2 border border-border/50">
        <div className="mb-1"><span className="text-[9px] text-muted-foreground">Strategies</span></div>
        <div className="space-y-1">
          {[{ n: "Breakout", p: "+$640", c: "text-emerald-400" }, { n: "Reversal", p: "+$210", c: "text-emerald-400" }, { n: "Scalp", p: "-$80", c: "text-red-400" }].map(r => (
            <div key={r.n} className="flex items-center justify-between">
              <span className="text-[8px] text-muted-foreground">{r.n}</span>
              <span className={`text-[8px] font-mono ${r.c}`}>{r.p}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (id === "recent_trades") {
    return (
      <div className="w-full bg-secondary/30 rounded-lg p-2 border border-border/50">
        <div className="mb-1"><span className="text-[9px] text-muted-foreground">Recent Trades</span></div>
        <div className="space-y-1">
          {[{ s: "EURUSD", p: "+$84", c: "text-emerald-400" }, { s: "AAPL", p: "-$32", c: "text-red-400" }, { s: "BTCUSD", p: "+$210", c: "text-emerald-400" }].map(r => (
            <div key={r.s} className="flex items-center justify-between">
              <span className="text-[8px] font-mono text-foreground">{r.s}</span>
              <span className={`text-[8px] font-mono ${r.c}`}>{r.p}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (id === "risk_panel") {
    return (
      <div className="w-full bg-secondary/30 rounded-lg p-2 border border-border/50">
        <div className="space-y-1">
          {[{ l: "Max Drawdown", v: "-$420" }, { l: "Sharpe Ratio", v: "1.84" }, { l: "Profit Factor", v: "2.14" }].map(r => (
            <div key={r.l} className="flex items-center justify-between">
              <span className="text-[8px] text-muted-foreground">{r.l}</span>
              <span className="text-[8px] font-mono text-foreground">{r.v}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Calendar-specific
  if (id === "cal_heatmap") {
    const days = [1, 3, -1, 2, -2, 0, 1, 3, 2, -1, 4, 1, 0, 2];
    return (
      <div className="w-full bg-secondary/30 rounded-lg p-2 border border-border/50">
        <div className="mb-1"><span className="text-[9px] text-muted-foreground">Daily Heatmap</span></div>
        <div className="grid grid-cols-7 gap-0.5">
          {days.map((v, i) => (
            <div key={i} className="aspect-square rounded-sm" style={{ backgroundColor: v > 0 ? `rgba(52,211,153,${Math.min(v * 0.3, 0.9)})` : v < 0 ? `rgba(248,113,113,${Math.min(Math.abs(v) * 0.3, 0.9)})` : "hsl(var(--secondary))" }} />
          ))}
        </div>
      </div>
    );
  }

  if (id === "cal_stats") {
    return (
      <div className="w-full bg-secondary/30 rounded-lg p-2 border border-border/50">
        <div className="grid grid-cols-2 gap-1">
          {[{ l: "Month P&L", v: "+$640", c: "text-emerald-400" }, { l: "Win Days", v: "12 / 18", c: "text-foreground" }, { l: "Best Day", v: "+$430", c: "text-emerald-400" }, { l: "Streak", v: "5 wins", c: "text-emerald-400" }].map(r => (
            <div key={r.l} className="bg-secondary/40 rounded p-1">
              <span className="text-[8px] text-muted-foreground block">{r.l}</span>
              <span className={`text-[9px] font-mono font-bold ${r.c}`}>{r.v}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-secondary/30 rounded-lg p-2 border border-border/50 flex items-center justify-center h-10">
      <span className="text-[9px] text-muted-foreground">Preview</span>
    </div>
  );
}
