// Post-trade review ("/app/reviews", Phase 2.2): a queue of closed-but-
// unreviewed trades (quick or full review mode — see
// components/reviews/TradeReviewModal.tsx), plus weekly/monthly period
// pages. The period pages only persist one thing — the trader's written
// commitment (period_reviews.commitment). Every stat shown (trade count,
// net P&L, top setups, emotional patterns, mistakes, strongest decisions)
// is derived live from trades + trade_reviews + tags in periodStats below,
// not stored separately, so there's exactly one source of truth for them.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VoiceTextarea } from "@/components/journal/VoiceTextarea";
import { TradeReviewModal } from "@/components/reviews/TradeReviewModal";
import { getWorkspace } from "@/lib/portfolios.functions";
import { listTrades, listTradeTagLinks, TRADES_LIST_DEFAULT_LIMIT } from "@/lib/trades.functions";
import { listTags } from "@/lib/tags.functions";
import {
  listPeriodReviews,
  listTradeReviews,
  listTradesNeedingReview,
  savePeriodReview,
} from "@/lib/reviews.functions";
import type { Database } from "@/integrations/supabase/types";

type TradeRow = Database["public"]["Tables"]["trades"]["Row"];

export const Route = createFileRoute("/app/reviews")({
  head: () => ({
    meta: [
      { title: "Reviews — Curated Trades" },
      { name: "description", content: "Work through your review queue and reflect on the week or month." },
    ],
  }),
  component: ReviewsPage,
});

type PeriodType = "weekly" | "monthly";

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getPeriodRange(periodType: PeriodType, offset: number): { start: Date; end: Date; label: string } {
  const now = new Date();
  if (periodType === "weekly") {
    const start = startOfWeek(now);
    start.setDate(start.getDate() + offset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    const label = `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    return { start, end, label };
  }
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59, 999);
  const label = start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return { start, end, label };
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function ReviewsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"queue" | PeriodType>("queue");
  const [periodOffset, setPeriodOffset] = useState(0);
  const [reviewingTrade, setReviewingTrade] = useState<TradeRow | null>(null);

  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => getWorkspace() });
  const workspace = workspaceQuery.data;
  const activePortfolioId = workspace?.activePortfolio.id;
  // Same scope rule as Journal / Analytics / Overview: undefined means
  // "All accounts". Reviews used to ignore the active account entirely.
  const activeAccountId = workspace?.activeAccount?.id;

  const queueQuery = useQuery({
    queryKey: ["trades-needing-review", activePortfolioId, activeAccountId],
    queryFn: () => listTradesNeedingReview({ data: { portfolioId: activePortfolioId as string, accountId: activeAccountId } }),
    enabled: activePortfolioId != null && tab === "queue",
  });

  const periodType: PeriodType = tab === "queue" ? "weekly" : tab;
  const { start, end, label } = useMemo(() => getPeriodRange(periodType, periodOffset), [periodType, periodOffset]);

  const tradesQuery = useQuery({
    queryKey: ["trades", activePortfolioId, activeAccountId, TRADES_LIST_DEFAULT_LIMIT],
    queryFn: () =>
      listTrades({ data: { portfolioId: activePortfolioId as string, accountId: activeAccountId, limit: TRADES_LIST_DEFAULT_LIMIT } }),
    enabled: activePortfolioId != null && tab !== "queue",
  });
  const reviewsQuery = useQuery({
    queryKey: ["trade-reviews-all", activePortfolioId],
    queryFn: () => listTradeReviews({ data: { portfolioId: activePortfolioId as string } }),
    enabled: tab !== "queue" && activePortfolioId != null,
  });
  const tagLinksQuery = useQuery({
    queryKey: ["trade-tag-links", activePortfolioId],
    queryFn: () => listTradeTagLinks({ data: { portfolioId: activePortfolioId as string } }),
    enabled: tab !== "queue" && activePortfolioId != null,
  });
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: () => listTags(), enabled: tab !== "queue" });

  const periodReviewsQuery = useQuery({
    queryKey: ["period-reviews", activePortfolioId, periodType],
    queryFn: () => listPeriodReviews({ data: { portfolioId: activePortfolioId as string, periodType } }),
    enabled: activePortfolioId != null && tab !== "queue",
  });
  const currentPeriodReview = periodReviewsQuery.data?.find((r) => r.period_start === toDateKey(start));
  const [commitment, setCommitment] = useState("");
  const periodKey = `${periodType}:${toDateKey(start)}`;
  useEffect(() => {
    setCommitment(currentPeriodReview?.commitment ?? "");
    // Re-seed whenever the period changes or its saved review loads.
  }, [periodKey, periodReviewsQuery.dataUpdatedAt]);

  const saveCommitmentMutation = useMutation({
    mutationFn: () =>
      savePeriodReview({
        data: {
          portfolioId: activePortfolioId as string,
          periodType,
          periodStart: toDateKey(start),
          periodEnd: toDateKey(end),
          commitment: commitment.trim() || null,
        },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["period-reviews", activePortfolioId, periodType] }),
  });

  const periodStats = useMemo(() => {
    const trades = (tradesQuery.data ?? []).filter((t) => {
      if (t.status !== "closed" || !t.closed_at) return false;
      const closed = new Date(t.closed_at);
      return closed >= start && closed <= end;
    });
    const reviews = reviewsQuery.data ?? [];
    const reviewByTradeId = new Map(reviews.map((r) => [r.trade_id, r]));
    const tagsById = new Map((tagsQuery.data ?? []).map((t) => [t.id, t]));
    const tradeIds = new Set(trades.map((t) => t.id));

    const netPnl = trades.reduce((sum, t) => sum + (t.net_pnl ?? 0), 0);
    const wins = trades.filter((t) => (t.net_pnl ?? 0) > 0).length;
    const winRate = trades.length > 0 ? Math.round((wins / trades.length) * 100) : null;

    const setupTotals = new Map<string, { count: number; netPnl: number }>();
    for (const trade of trades) {
      const snapshot = trade.playbook_snapshot as { name?: string } | null;
      const name = snapshot?.name ?? "No playbook";
      const entry = setupTotals.get(name) ?? { count: 0, netPnl: 0 };
      entry.count += 1;
      entry.netPnl += trade.net_pnl ?? 0;
      setupTotals.set(name, entry);
    }
    const topSetups = Array.from(setupTotals.entries())
      .sort((a, b) => b[1].netPnl - a[1].netPnl)
      .slice(0, 3);

    const emotionCounts = new Map<string, number>();
    const bestDecisions: string[] = [];
    for (const trade of trades) {
      const review = reviewByTradeId.get(trade.id);
      if (!review) continue;
      for (const emotion of [review.emotional_state_before, review.emotional_state_during, review.emotional_state_after]) {
        if (!emotion) continue;
        emotionCounts.set(emotion, (emotionCounts.get(emotion) ?? 0) + 1);
      }
      if (review.best_decision) bestDecisions.push(review.best_decision);
    }
    const topEmotions = Array.from(emotionCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);

    const mistakeCounts = new Map<string, number>();
    for (const link of tagLinksQuery.data ?? []) {
      if (!tradeIds.has(link.trade_id)) continue;
      const tag = tagsById.get(link.tag_id);
      if (!tag || tag.category !== "mistake") continue;
      mistakeCounts.set(tag.name, (mistakeCounts.get(tag.name) ?? 0) + 1);
    }
    const topMistakes = Array.from(mistakeCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);

    const reviewedCount = trades.filter((t) => reviewByTradeId.has(t.id)).length;

    return { trades, netPnl, winRate, topSetups, topEmotions, topMistakes, bestDecisions: bestDecisions.slice(0, 3), reviewedCount };
  }, [tradesQuery.data, reviewsQuery.data, tagLinksQuery.data, tagsQuery.data, start, end]);

  const accountNameById = useMemo(
    () => new Map((workspace?.accounts ?? []).map((account) => [account.id, account.name])),
    [workspace?.accounts],
  );
  const showAccountColumn = activeAccountId == null && (workspace?.accounts.length ?? 0) > 1;

  const queueStats = useMemo(() => {
    const queue = queueQuery.data ?? [];
    const netPnl = queue.reduce((sum, t) => sum + (t.net_pnl ?? 0), 0);
    const wins = queue.filter((t) => (t.net_pnl ?? 0) > 0).length;
    const oldest = queue.reduce<number | null>((min, t) => {
      if (!t.closed_at) return min;
      const ts = new Date(t.closed_at).getTime();
      return min == null || ts < min ? ts : min;
    }, null);
    return {
      count: queue.length,
      netPnl,
      winRate: queue.length > 0 ? Math.round((wins / queue.length) * 100) : null,
      oldestDays: oldest != null ? Math.max(0, Math.floor((Date.now() - oldest) / 86_400_000)) : null,
    };
  }, [queueQuery.data]);

  function invalidateQueue() {
    void queryClient.invalidateQueries({ queryKey: ["trades-needing-review", activePortfolioId] });
    void queryClient.invalidateQueries({ queryKey: ["trade-reviews-all"] });
  }

  if (workspaceQuery.isLoading || !workspace) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading reviews…</p>;
  }

  const queue = queueQuery.data ?? [];
  const scopeLabel = workspace.activeAccount?.name ?? "All accounts";

  const pnlClass = (value: number) => (value >= 0 ? "text-chart-2" : "text-destructive");
  const money = (value: number) =>
    `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <>
      <section className="mb-4 flex flex-col justify-between gap-1 sm:flex-row sm:items-end">
        <div>
          <h1 className="page-title">Reviews</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Work through unreviewed trades, then reflect on the week or month.</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Showing <span className="font-semibold text-foreground">{scopeLabel}</span>
        </p>
      </section>

      <div className="tab-bar mb-5" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "queue"} className={`tab ${tab === "queue" ? "tab-active" : ""}`} onClick={() => setTab("queue")}>
          <ClipboardList className="size-4" /> Review queue
          {queueStats.count > 0 && <Badge variant={tab === "queue" ? "default" : "secondary"}>{queueStats.count}</Badge>}
        </button>
        <button type="button" role="tab" aria-selected={tab === "weekly"} className={`tab ${tab === "weekly" ? "tab-active" : ""}`} onClick={() => setTab("weekly")}>
          Weekly review
        </button>
        <button type="button" role="tab" aria-selected={tab === "monthly"} className={`tab ${tab === "monthly" ? "tab-active" : ""}`} onClick={() => setTab("monthly")}>
          Monthly review
        </button>
      </div>

      {tab === "queue" && (
        <div className="space-y-4">
          <div className="metric-grid">
            <div className="metric-card">
              <p className="eyebrow mb-1">Awaiting review</p>
              <p className="metric-value">{queueStats.count}</p>
            </div>
            <div className="metric-card">
              <p className="eyebrow mb-1">Net P&L in queue</p>
              <p className={`metric-value ${queueStats.count > 0 ? pnlClass(queueStats.netPnl) : ""}`}>{queueStats.count > 0 ? money(queueStats.netPnl) : "—"}</p>
            </div>
            <div className="metric-card">
              <p className="eyebrow mb-1">Win rate in queue</p>
              <p className="metric-value">{queueStats.winRate != null ? `${queueStats.winRate}%` : "—"}</p>
            </div>
            <div className="metric-card">
              <p className="eyebrow mb-1">Oldest waiting</p>
              <p className="metric-value">{queueStats.oldestDays != null ? `${queueStats.oldestDays}d` : "—"}</p>
            </div>
          </div>

          <div className="surface-panel overflow-hidden p-0">
            <div className="panel-bar">
              <h2 className="panel-title">Closed trades without a review</h2>
              <span className="text-xs text-muted-foreground">Most recent first</span>
            </div>
            {queueQuery.isLoading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading queue…</p>
            ) : queue.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <CheckCircle2 className="size-8 text-chart-2" />
                <p className="text-sm font-medium">You're all caught up</p>
                <p className="text-xs text-muted-foreground">Every closed trade in {scopeLabel} has a review.</p>
              </div>
            ) : (
              <div className="trade-table-wrap">
                <table className="trade-table">
                  <thead>
                    <tr>
                      <th>Closed</th>
                      <th>Symbol</th>
                      <th>Side</th>
                      {showAccountColumn && <th>Account</th>}
                      <th className="num">Net P&L</th>
                      <th className="num">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.map((trade) => (
                      <tr key={trade.id}>
                        <td className="text-muted-foreground">{trade.closed_at ? new Date(trade.closed_at).toLocaleDateString() : "—"}</td>
                        <td className="font-semibold">{trade.symbol}</td>
                        <td>
                          <span className="direction capitalize">{trade.direction}</span>
                        </td>
                        {showAccountColumn && (
                          <td className="text-muted-foreground">{trade.account_id ? (accountNameById.get(trade.account_id) ?? "—") : "—"}</td>
                        )}
                        <td className={`num font-mono font-semibold ${pnlClass(trade.net_pnl ?? 0)}`}>{money(trade.net_pnl ?? 0)}</td>
                        <td className="num">
                          <Button type="button" variant="outline" size="sm" onClick={() => setReviewingTrade(trade)}>
                            Review
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {(tab === "weekly" || tab === "monthly") && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="icon" aria-label="Previous period" onClick={() => setPeriodOffset((o) => o - 1)}>
              <ChevronLeft />
            </Button>
            <div className="flex h-8 min-w-48 items-center justify-center rounded-md border border-input bg-card px-3 text-[13px] font-semibold shadow-xs">
              {label}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Next period"
              onClick={() => setPeriodOffset((o) => Math.min(0, o + 1))}
              disabled={periodOffset >= 0}
            >
              <ChevronRight />
            </Button>
            {periodOffset < 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setPeriodOffset(0)}>
                Current {periodType === "weekly" ? "week" : "month"}
              </Button>
            )}
          </div>

          <div className="metric-grid">
            <div className="metric-card">
              <p className="eyebrow mb-1">Closed trades</p>
              <p className="metric-value">{periodStats.trades.length}</p>
            </div>
            <div className="metric-card">
              <p className="eyebrow mb-1">Net P&L</p>
              <p className={`metric-value ${periodStats.trades.length > 0 ? pnlClass(periodStats.netPnl) : ""}`}>
                {periodStats.trades.length > 0 ? money(periodStats.netPnl) : "—"}
              </p>
            </div>
            <div className="metric-card">
              <p className="eyebrow mb-1">Win rate</p>
              <p className="metric-value">{periodStats.winRate != null ? `${periodStats.winRate}%` : "—"}</p>
            </div>
            <div className="metric-card">
              <p className="eyebrow mb-1">Reviewed</p>
              <p className="metric-value">
                {periodStats.reviewedCount}
                <span className="text-base font-medium text-muted-foreground"> / {periodStats.trades.length}</span>
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="surface-panel overflow-hidden p-0">
              <div className="panel-bar">
                <h3 className="panel-title">Top setups</h3>
              </div>
              {periodStats.topSetups.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground">No closed trades this period.</p>
              ) : (
                <table className="trade-table">
                  <thead>
                    <tr>
                      <th>Setup</th>
                      <th className="num">Trades</th>
                      <th className="num">Net P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodStats.topSetups.map(([name, stats]) => (
                      <tr key={name}>
                        <td className="max-w-40 truncate">{name}</td>
                        <td className="num font-mono">{stats.count}</td>
                        <td className={`num font-mono font-semibold ${pnlClass(stats.netPnl)}`}>{money(stats.netPnl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="surface-panel overflow-hidden p-0">
              <div className="panel-bar">
                <h3 className="panel-title">Emotional patterns</h3>
              </div>
              <div className="p-4">
                {periodStats.topEmotions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No reviews logged this period yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {periodStats.topEmotions.map(([emotion, count]) => (
                      <Badge key={emotion} variant="secondary">
                        {emotion} × {count}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="surface-panel overflow-hidden p-0">
              <div className="panel-bar">
                <h3 className="panel-title">Mistakes</h3>
              </div>
              <div className="p-4">
                {periodStats.topMistakes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No mistake tags logged this period.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {periodStats.topMistakes.map(([name, count]) => (
                      <Badge key={name} variant="destructive">
                        {name} × {count}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {periodStats.bestDecisions.length > 0 && (
            <div className="surface-panel overflow-hidden p-0">
              <div className="panel-bar">
                <h3 className="panel-title flex items-center gap-1.5">
                  <Sparkles className="size-4 text-chart-2" /> Strongest decisions
                </h3>
              </div>
              <ul className="divide-y divide-border text-[13px]">
                {periodStats.bestDecisions.map((text, i) => (
                  <li key={i} className="px-4 py-2.5">
                    {text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="surface-panel overflow-hidden p-0">
            <div className="panel-bar">
              <h3 className="panel-title">Next-{periodType === "weekly" ? "week" : "month"} commitment</h3>
            </div>
            <div className="p-4">
              <VoiceTextarea
                value={commitment}
                onChange={setCommitment}
                rows={3}
                placeholder="One specific thing to do differently next period"
              />
            </div>
            <div className="form-actions">
              <Button type="button" size="sm" disabled={saveCommitmentMutation.isPending} onClick={() => saveCommitmentMutation.mutate()}>
                {saveCommitmentMutation.isPending ? "Saving…" : "Save commitment"}
              </Button>
              <span className="text-xs text-muted-foreground">Saved per portfolio, not per account.</span>
            </div>
          </div>
        </div>
      )}

      {reviewingTrade && (
        <TradeReviewModal
          trade={reviewingTrade}
          onClose={() => setReviewingTrade(null)}
          onSaved={() => {
            setReviewingTrade(null);
            invalidateQueue();
          }}
        />
      )}
    </>
  );
}
