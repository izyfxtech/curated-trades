import React, { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { entities } from '@/api/entities';
import { useQuery, useMutation } from "@tanstack/react-query";
import { calcStats, formatCurrency } from "@/lib/tradeUtils";
import { TrendingUp, Target, BarChart3, DollarSign, Lock, AlertCircle } from "lucide-react";
import EquityCurve from "@/components/dashboard/EquityCurve";
import WinLossDistribution from "@/components/analytics/WinLossDistribution";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

function TradeDetail({ trade }) {
  const isWin = (trade.pnl || 0) > 0;
  const isOpen = trade.outcome === "open" || (!trade.close_time && !trade.exit_price);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className={cn(
          "w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-mono font-bold",
          isOpen ? "bg-primary/10 text-primary" : isWin ? "bg-emerald-400/10 text-emerald-400" : "bg-red-400/10 text-red-400"
        )}>
          {isOpen ? "—" : isWin ? "▲" : "▼"}
        </div>
        <div>
          <h2 className="text-2xl font-heading font-bold text-foreground">{trade.symbol}</h2>
          <p className="text-sm text-muted-foreground capitalize">
            {trade.direction} · {trade.strategy || "No strategy"} · {trade.session || ""}
          </p>
        </div>
        <div className="ml-auto text-right">
          <p className={cn(
            "text-3xl font-mono font-bold",
            isOpen ? "text-primary" : isWin ? "text-emerald-400" : "text-red-400"
          )}>
            {isOpen ? "OPEN" : (isWin ? "+" : "") + formatCurrency(trade.pnl || 0)}
          </p>
          {!isOpen && trade.net_pnl !== undefined && (
            <p className="text-xs text-muted-foreground">Net: {formatCurrency(trade.net_pnl)}</p>
          )}
        </div>
      </div>

      {/* Key data */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { l: "Entry", v: trade.entry_price },
          { l: "Exit", v: trade.exit_price || "—" },
          { l: "Quantity", v: trade.lot_size },
          { l: "R:R", v: trade.risk_reward ? `${trade.risk_reward.toFixed(2)}R` : "—" },
          { l: "Opened", v: trade.open_time ? format(new Date(trade.open_time), "MMM d, yyyy HH:mm") : "—" },
          { l: "Closed", v: trade.close_time ? format(new Date(trade.close_time), "MMM d, yyyy HH:mm") : "—" },
          { l: "Duration", v: trade.duration_minutes ? `${Math.round(trade.duration_minutes)}m` : "—" },
          { l: "Rating", v: trade.rating ? `${trade.rating}/5` : "—" },
        ].map(s => (
          <div key={s.l} className="bg-secondary/20 rounded-xl p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{s.l}</p>
            <p className="text-sm font-mono font-semibold text-foreground">{s.v}</p>
          </div>
        ))}
      </div>

      {/* Screenshots */}
      {trade.screenshots?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Screenshots</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {trade.screenshots.map((url, i) => (
              <img key={i} src={url} alt={`Trade screenshot ${i + 1}`} className="rounded-xl border border-border w-full object-cover" />
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {trade.notes && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Journal Notes</p>
          <div className="bg-secondary/20 rounded-xl p-4 text-sm text-foreground leading-relaxed prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: trade.notes }} />
        </div>
      )}
    </div>
  );
}

export default function PublicSharedView() {
  const { slug } = useParams();

  const { data: sharedViews = [], isLoading: loadingView } = useQuery({
    queryKey: ["publicSharedView", slug],
    queryFn: () => entities.SharedView.filter({ slug }),
  });

  const view = sharedViews[0];

  const { data: trades = [], isLoading: loadingTrades } = useQuery({
    queryKey: ["trades"],
    queryFn: () => entities.Trade.list("-close_time", 500),
    enabled: !!view && view.type === "performance",
  });

  const { data: singleTrade, isLoading: loadingTrade } = useQuery({
    queryKey: ["trade", view?.trade_id],
    queryFn: () => entities.Trade.filter({ id: view.trade_id }).then(r => r[0]),
    enabled: !!view && view.type === "trade" && !!view.trade_id,
  });

  const incrementMutation = useMutation({
    mutationFn: (id) => entities.SharedView.update(id, { views: (view?.views || 0) + 1 }),
  });

  useEffect(() => {
    if (view?.id) {
      incrementMutation.mutate(view.id);
    }
  }, [view?.id]);

  const filteredTrades = useMemo(() => {
    if (!view || view.type !== "performance") return trades;
    const period = view.time_period;
    if (!period || period === "all") return trades;
    const cutoff = new Date();
    if (period === "7d") cutoff.setDate(cutoff.getDate() - 7);
    if (period === "30d") cutoff.setDate(cutoff.getDate() - 30);
    if (period === "90d") cutoff.setDate(cutoff.getDate() - 90);
    if (period === "1y") cutoff.setFullYear(cutoff.getFullYear() - 1);
    return trades.filter(t => new Date(t.close_time || t.created_date) >= cutoff);
  }, [trades, view]);

  const stats = useMemo(() => calcStats(filteredTrades), [filteredTrades]);

  const isLoading = loadingView || loadingTrades || loadingTrade;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!view) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <AlertCircle className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="text-xl font-heading font-bold text-foreground mb-2">Link not found</h2>
          <p className="text-sm text-muted-foreground">This shared link doesn't exist or has been removed.</p>
        </div>
      </div>
    );
  }

  if (!view.is_public) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <Lock className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="text-xl font-heading font-bold text-foreground mb-2">This link is private</h2>
          <p className="text-sm text-muted-foreground">The owner has set this link to private.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 py-4 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span className="font-heading font-bold text-foreground text-sm">CuratedTrades</span>
          </div>
          <p className="text-xs text-muted-foreground">Shared view · read only</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">{view.title || "Trading Performance"}</h1>
        </div>

        {view.type === "performance" && (
          <>
            <div className={cn("grid gap-3", view.simplified ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4")}>
              {[
                { icon: DollarSign, label: "Net Profit", value: formatCurrency(stats.totalPnl), colored: true, positive: stats.totalPnl >= 0 },
                { icon: Target, label: "Win Rate", value: `${stats.winRate.toFixed(1)}%` },
                ...(!view.simplified ? [
                  { icon: BarChart3, label: "Profit Factor", value: stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2) },
                  { icon: TrendingUp, label: "Avg R:R", value: `${stats.avgRR?.toFixed(2) || "—"}R` },
                ] : []),
              ].map((s, i) => (
                <div key={i} className="bg-card rounded-xl border border-border p-4 overflow-hidden">
                  <s.icon className="w-4 h-4 text-muted-foreground mb-2" />
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={cn("text-lg md:text-xl font-mono font-bold truncate", s.colored ? (s.positive ? "text-emerald-400" : "text-red-400") : "text-foreground")}>
                    {s.value}
                  </p>
                </div>
              ))}
            </div>
            {view.show_equity !== false && <EquityCurve trades={filteredTrades} />}
            {view.show_distribution !== false && <WinLossDistribution trades={filteredTrades} />}
          </>
        )}

        {view.type === "trade" && singleTrade && (
          <TradeDetail trade={singleTrade} />
        )}
      </div>
    </div>
  );
}
