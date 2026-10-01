// Post-trade review ("/app/reviews", Phase 2.2): a queue of closed-but-
// unreviewed trades (quick or full review mode — see
// components/reviews/TradeReviewModal.tsx), plus weekly/monthly period
// pages. The period pages only persist one thing — the trader's written
// commitment (period_reviews.commitment). Every stat shown (trade count,
// net P&L, top setups, emotional patterns, mistakes, strongest decisions)
// is derived live from trades + trade_reviews + tags in periodStats below,
// not stored separately, so there's exactly one source of truth for them.
//
// The active tab, the period being viewed (?offset=-1 is last week/month) and
// the trade open in the review modal (?review=<id>) are URL search params, so
// the view survives refresh and is linkable; the commitment box is a small
// TanStack Form.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Sparkles } from "lucide-react";
import { z } from "zod";

import { VoiceTextarea } from "@/components/journal/VoiceTextarea";
import { TradeReviewModal } from "@/components/reviews/TradeReviewModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formProps, useAppForm } from "@/lib/form";
import { currencyByAccountId, formatSignedMoney, workspaceCurrency } from "@/lib/money";
import {
  periodReviewsQueryOptions,
  queryKeys,
  tagsQueryOptions,
  tradeReviewsQueryOptions,
  tradesNeedingReviewQueryOptions,
  tradesQueryOptions,
  tradeTagLinksQueryOptions,
  workspaceQueryOptions,
} from "@/lib/queries";
import { savePeriodReview } from "@/lib/reviews.functions";

export const Route = createFileRoute("/app/reviews")({
  head: () => ({
    meta: [
      { title: "Reviews — Curated Trades" },
      { name: "description", content: "Work through your review queue and reflect on the week or month." },
    ],
  }),
  validateSearch: z.object({
    tab: z.enum(["queue", "weekly", "monthly"]).optional(),
    /** 0 = current period, -1 = previous, … */
    offset: z.number().int().max(0).optional(),
    /** Id of the queued trade open in the review modal. */
    review: z.string().optional(),
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

/** The queue's stats cover every unreviewed trade; the table shows the newest
 * this many (working through them reveals the next ones). */
const QUEUE_ROWS_SHOWN = 100;

function CommitmentForm({ initial, isPending, onSave }: { initial: string; isPending: boolean; onSave: (commitment: string) => void }) {
  const form = useAppForm({
    defaultValues: { commitment: initial },
    onSubmit: ({ value }) => onSave(value.commitment),
  });
  return (
    <form {...formProps(form)}>
      <div className="p-4">
        <form.Field name="commitment">
          {(field) => (
            <VoiceTextarea
              value={field.state.value}
              onChange={field.handleChange}
              rows={3}
              placeholder="One specific thing to do differently next period"
            />
          )}
        </form.Field>
      </div>
      <div className="form-actions">
        <form.AppForm>
          <form.SubmitButton size="sm" pendingLabel="Saving…" pending={isPending}>
            Save commitment
          </form.SubmitButton>
        </form.AppForm>
        <span className="text-xs text-muted-foreground">Saved per portfolio, not per account.</span>
      </div>
    </form>
  );
}

function ReviewsPage() {
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const tab = search.tab ?? "queue";
  const periodOffset = search.offset ?? 0;
  const setSearch = (patch: { tab?: "queue" | "weekly" | "monthly" | undefined; offset?: number | undefined; review?: string | undefined }) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const { data: workspace } = useQuery(workspaceQueryOptions);
  const activePortfolioId = workspace?.activePortfolio.id;
  // Same scope rule as Journal / Analytics / Overview: undefined means
  // "All accounts". Reviews used to ignore the active account entirely.
  const activeAccountId = workspace?.activeAccount?.id;
  const isQueue = tab === "queue";

  const queueQuery = useQuery(tradesNeedingReviewQueryOptions(activePortfolioId, activeAccountId, isQueue));

  const periodType: PeriodType = tab === "queue" ? "weekly" : tab;
  const { start, end, label } = getPeriodRange(periodType, periodOffset);

  const tradesQuery = useQuery({
    ...tradesQueryOptions(activePortfolioId, activeAccountId),
    enabled: !isQueue,
  });
  const reviewsQuery = useQuery({ ...tradeReviewsQueryOptions(activePortfolioId), enabled: !isQueue });
  const tagLinksQuery = useQuery({ ...tradeTagLinksQueryOptions(activePortfolioId), enabled: !isQueue });
  const tagsQuery = useQuery({ ...tagsQueryOptions, enabled: !isQueue });
  const periodReviewsQuery = useQuery(periodReviewsQueryOptions(activePortfolioId, periodType, !isQueue));
  const currentPeriodReview = periodReviewsQuery.data?.find((r) => r.period_start === toDateKey(start));

  const saveCommitmentMutation = useMutation({
    mutationFn: (commitment: string) =>
      savePeriodReview({
        data: {
          portfolioId: activePortfolioId as string,
          periodType,
          periodStart: toDateKey(start),
          periodEnd: toDateKey(end),
          commitment: commitment.trim() || null,
        },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: periodReviewsQueryOptions(activePortfolioId, periodType, true).queryKey }),
  });

  const periodStats = (() => {
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
  })();

  const accountNameById = new Map((workspace?.accounts ?? []).map((account) => [account.id, account.name]));
  const showAccountColumn = activeAccountId == null && (workspace?.accounts.length ?? 0) > 1;
  // Aggregates (queue/period/setup totals) display in one currency, matching
  // the convention used in index.tsx and analytics.tsx. Individual trades in
  // the queue table — which can span accounts when "All accounts" is
  // selected, same as showAccountColumn above — use their own account's.
  const currency = workspace ? workspaceCurrency(workspace) : "USD";
  const currencyMap = currencyByAccountId(workspace?.accounts ?? []);

  const queueStats = (() => {
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
  })();

  function invalidateQueue() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.tradesNeedingReview(activePortfolioId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.tradeReviews() });
    // Analytics includes review data (emotions, mistakes), and the Journal rows
    // show a reviewed flag — both live under the portfolio's "trades" keys.
    void queryClient.invalidateQueries({ queryKey: queryKeys.trades(activePortfolioId) });
  }

  if (!workspace) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading reviews…</p>;
  }

  const queue = queueQuery.data ?? [];
  const reviewingTrade = search.review ? (queue.find((trade) => trade.id === search.review) ?? null) : null;
  const scopeLabel = workspace.activeAccount?.name ?? "All accounts";

  const pnlClass = (value: number) => (value >= 0 ? "text-chart-2" : "text-destructive");

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
        <button type="button" role="tab" aria-selected={tab === "queue"} className={`tab ${tab === "queue" ? "tab-active" : ""}`} onClick={() => setSearch({ tab: undefined, offset: undefined })}>
          <ClipboardList className="size-4" /> Review queue
          {queueStats.count > 0 && <Badge variant={tab === "queue" ? "default" : "secondary"}>{queueStats.count}</Badge>}
        </button>
        <button type="button" role="tab" aria-selected={tab === "weekly"} className={`tab ${tab === "weekly" ? "tab-active" : ""}`} onClick={() => setSearch({ tab: "weekly", offset: undefined })}>
          Weekly review
        </button>
        <button type="button" role="tab" aria-selected={tab === "monthly"} className={`tab ${tab === "monthly" ? "tab-active" : ""}`} onClick={() => setSearch({ tab: "monthly", offset: undefined })}>
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
              <p className={`metric-value ${queueStats.count > 0 ? pnlClass(queueStats.netPnl) : ""}`}>{queueStats.count > 0 ? formatSignedMoney(queueStats.netPnl, currency) : "—"}</p>
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
              <span className="text-xs text-muted-foreground">
                {queue.length > QUEUE_ROWS_SHOWN
                  ? `Most recent ${QUEUE_ROWS_SHOWN} of ${queue.length.toLocaleString()} — the totals above cover all of them`
                  : "Most recent first"}
              </span>
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
                    {queue.slice(0, QUEUE_ROWS_SHOWN).map((trade) => (
                      <tr key={trade.id}>
                        <td className="text-muted-foreground">{trade.closed_at ? new Date(trade.closed_at).toLocaleDateString() : "—"}</td>
                        <td className="font-semibold">{trade.symbol}</td>
                        <td>
                          <span className="direction capitalize">{trade.direction}</span>
                        </td>
                        {showAccountColumn && (
                          <td className="text-muted-foreground">{trade.account_id ? (accountNameById.get(trade.account_id) ?? "—") : "—"}</td>
                        )}
                        <td className={`num font-mono font-semibold ${pnlClass(trade.net_pnl ?? 0)}`}>{formatSignedMoney(trade.net_pnl ?? 0, currencyMap.get(trade.account_id) ?? currency)}</td>
                        <td className="num">
                          <Button type="button" variant="outline" size="sm" onClick={() => setSearch({ review: trade.id })}>
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
            <Button type="button" variant="outline" size="icon" aria-label="Previous period" onClick={() => setSearch({ offset: periodOffset - 1 })}>
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
              onClick={() => setSearch({ offset: Math.min(0, periodOffset + 1) || undefined })}
              disabled={periodOffset >= 0}
            >
              <ChevronRight />
            </Button>
            {periodOffset < 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setSearch({ offset: undefined })}>
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
                {periodStats.trades.length > 0 ? formatSignedMoney(periodStats.netPnl, currency) : "—"}
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
                        <td className={`num font-mono font-semibold ${pnlClass(stats.netPnl)}`}>{formatSignedMoney(stats.netPnl, currency)}</td>
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
            {/* Re-seeded (via key) whenever the period changes or its saved review loads. */}
            <CommitmentForm
              key={`${periodType}:${toDateKey(start)}:${currentPeriodReview?.id ?? "none"}`}
              initial={currentPeriodReview?.commitment ?? ""}
              isPending={saveCommitmentMutation.isPending}
              onSave={(commitment) => saveCommitmentMutation.mutate(commitment)}
            />
          </div>
        </div>
      )}

      {reviewingTrade && (
        <TradeReviewModal
          trade={reviewingTrade}
          onClose={() => setSearch({ review: undefined })}
          onSaved={() => {
            setSearch({ review: undefined });
            invalidateQueue();
          }}
        />
      )}
    </>
  );
}
