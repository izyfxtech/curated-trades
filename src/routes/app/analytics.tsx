// Deeper analytics ("/app/analytics", Phase 2.3): overview metrics, ratio
// metrics, R-multiple distribution, the daily P&L heatmap, Curated vs.
// Impulse comparison, a breakdown explorer across every dimension the plan
// specifies (setup, symbol, session, day of week, emotion, mistake, etc. —
// see lib/analytics.ts), and streak distribution. Deterministic insight
// cards sit at the top — every single one traces to one of exactly three
// explicit rules in generateInsights() (lib/analytics.ts), not a statistical
// or AI-generated judgment call.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { format, startOfDay, subDays } from "date-fns";
import { Percent, TrendingDown, TrendingUp, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Input } from "@/components/ui/input";
import { getWorkspace } from "@/lib/portfolios.functions";
import { listTrades, listTradeTagLinks, TRADES_LIST_DEFAULT_LIMIT } from "@/lib/trades.functions";
import { listTradeReviews } from "@/lib/reviews.functions";
import { listTags } from "@/lib/tags.functions";
import { summarizeClosedTrades, type ClosedTradeForAnalytics } from "@/lib/trade-calc";
import { buildEquityCurve } from "@/lib/equity-curve";
import { MetricCard } from "@/components/journal/dashboard-widgets";
import { EquityCurveChart } from "@/components/analytics/EquityCurveChart";
import { ComparisonBar } from "@/components/analytics/ComparisonBar";
import { PnlHeatmap } from "@/components/analytics/PnlHeatmap";
import { SessionBreakdownPanel } from "@/components/analytics/SessionBreakdownPanel";
import { BreakdownExplorer } from "@/components/analytics/BreakdownExplorer";
import { RDistributionChart } from "@/components/analytics/RDistributionChart";
import { StreakDistributionCard } from "@/components/analytics/StreakDistributionCard";
import { InsightCards } from "@/components/analytics/InsightCards";
import {
  computeBreakdown,
  computeRatioMetrics,
  computeRDistribution,
  computeStreakDistribution,
  enrichTrades,
  generateInsights,
  type BreakdownDimension,
} from "@/lib/analytics";

export const Route = createFileRoute("/app/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — Curated Trades" },
      { name: "description", content: "Deeper breakdowns: Curated vs Impulse, daily P&L, and performance over time." },
    ],
  }),
  component: AnalyticsPage,
});

const RANGE_OPTIONS = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "All", days: null },
] as const;

function AnalyticsPage() {
  const navigate = useNavigate();
  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => getWorkspace() });
  const workspace = workspaceQuery.data;
  const activePortfolioId = workspace?.activePortfolio.id;

  const tradesQuery = useQuery({
    queryKey: ["trades", activePortfolioId, workspace?.activeAccount?.id, TRADES_LIST_DEFAULT_LIMIT],
    queryFn: () =>
      listTrades({
        data: { portfolioId: activePortfolioId as string, accountId: workspace?.activeAccount?.id, limit: TRADES_LIST_DEFAULT_LIMIT },
      }),
    enabled: activePortfolioId != null,
  });
  const allTrades = useMemo(() => tradesQuery.data ?? [], [tradesQuery.data]);

  const reviewsQuery = useQuery({
    queryKey: ["trade-reviews-all", activePortfolioId],
    queryFn: () => listTradeReviews({ data: { portfolioId: activePortfolioId as string } }),
    enabled: activePortfolioId != null,
  });
  const tagLinksQuery = useQuery({
    queryKey: ["trade-tag-links", activePortfolioId],
    queryFn: () => listTradeTagLinks({ data: { portfolioId: activePortfolioId as string } }),
    enabled: activePortfolioId != null,
  });
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: () => listTags() });

  const [rangeDays, setRangeDays] = useState<number | null>(30);
  // A non-empty custom range always takes priority over the preset buttons —
  // set together, they'd disagree about what's selected, so picking a custom
  // range clears `rangeDays` down to "not a preset" instead of leaving a
  // preset visually highlighted for a range it no longer describes.
  const [customRange, setCustomRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [minSampleSize, setMinSampleSize] = useState(5);
  const [dimension, setDimension] = useState<BreakdownDimension>("setup");

  const hasCustomRange = customRange.from !== "" || customRange.to !== "";

  // The actual [start, end] window every chart/metric on this page filters
  // to. Previously only the preset buttons existed — there was no way to
  // ask "how did I do in the first two weeks of March" without scrolling
  // through the journal by hand.
  const { rangeStart, rangeEnd } = useMemo(() => {
    const today = startOfDay(new Date());
    if (hasCustomRange) {
      const earliestTrade = allTrades.reduce<Date | null>((earliest, t) => {
        const opened = startOfDay(new Date(t.opened_at));
        return !earliest || opened < earliest ? opened : earliest;
      }, null);
      return {
        rangeStart: customRange.from ? startOfDay(new Date(customRange.from)) : (earliestTrade ?? today),
        rangeEnd: customRange.to ? startOfDay(new Date(customRange.to)) : today,
      };
    }
    if (rangeDays == null) {
      const earliestTrade = allTrades.reduce<Date | null>((earliest, t) => {
        const opened = startOfDay(new Date(t.opened_at));
        return !earliest || opened < earliest ? opened : earliest;
      }, null);
      return { rangeStart: earliestTrade ?? subDays(today, 30), rangeEnd: today };
    }
    return { rangeStart: subDays(today, rangeDays - 1), rangeEnd: today };
  }, [hasCustomRange, customRange, rangeDays, allTrades]);

  const trades = useMemo(() => {
    const startMs = rangeStart.getTime();
    const endMs = rangeEnd.getTime() + 24 * 60 * 60 * 1000 - 1; // inclusive of the end day
    return allTrades.filter((t) => {
      const openedMs = new Date(t.opened_at).getTime();
      return openedMs >= startMs && openedMs <= endMs;
    });
  }, [allTrades, rangeStart, rangeEnd]);

  const closedTrades = useMemo(() => trades.filter((t) => t.status === "closed" && t.net_pnl != null), [trades]);
  const startingEquity = workspace?.startingEquity ?? 50000;

  const enrichedTrades = useMemo(
    () => enrichTrades(trades, reviewsQuery.data ?? [], tagLinksQuery.data ?? [], tagsQuery.data ?? []),
    [trades, reviewsQuery.data, tagLinksQuery.data, tagsQuery.data],
  );

  const breakdownGroups = useMemo(
    () => computeBreakdown(enrichedTrades, dimension, startingEquity, minSampleSize),
    [enrichedTrades, dimension, startingEquity, minSampleSize],
  );

  const rDistribution = useMemo(() => computeRDistribution(closedTrades), [closedTrades]);
  const streakDistribution = useMemo(() => computeStreakDistribution(closedTrades), [closedTrades]);
  const sessionGroups = useMemo(() => computeBreakdown(enrichedTrades, "session", startingEquity, 1), [enrichedTrades, startingEquity]);

  const equityCurve = useMemo(
    () =>
      buildEquityCurve(
        closedTrades.map((t) => ({ id: t.id, symbol: t.symbol, netPnl: t.net_pnl, openedAt: t.opened_at, closedAt: t.closed_at })),
        startingEquity,
        { width: 900, height: 240 },
      ),
    [closedTrades, startingEquity],
  );

  const analyticsInput: ClosedTradeForAnalytics[] = useMemo(
    () =>
      closedTrades.map((t) => ({
        id: t.id,
        netPnl: t.net_pnl ?? 0,
        realizedRMultiple: t.realized_r_multiple,
        curatedLabel: t.curated_label === "curated" ? "curated" : "impulse",
        openedAt: t.opened_at,
        closedAt: t.closed_at,
      })),
    [closedTrades],
  );
  const overall = useMemo(() => summarizeClosedTrades(analyticsInput, startingEquity), [analyticsInput, startingEquity]);
  const ratioMetrics = useMemo(
    () => computeRatioMetrics(closedTrades, overall.netPnl, overall.maxDrawdownDollars),
    [closedTrades, overall.netPnl, overall.maxDrawdownDollars],
  );
  const insights = useMemo(
    () => generateInsights(enrichedTrades, startingEquity, minSampleSize, overall),
    [enrichedTrades, startingEquity, minSampleSize, overall],
  );
  const curatedOnly = useMemo(
    () => summarizeClosedTrades(analyticsInput.filter((t) => t.curatedLabel === "curated"), startingEquity),
    [analyticsInput, startingEquity],
  );
  const impulseOnly = useMemo(
    () => summarizeClosedTrades(analyticsInput.filter((t) => t.curatedLabel === "impulse"), startingEquity),
    [analyticsInput, startingEquity],
  );

  // Daily P&L, keyed by day — spans whatever [rangeStart, rangeEnd] the page
  // is currently filtered to (see PnlHeatmap for the calendar-grid layout).
  const pnlByDay = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const trade of closedTrades) {
      const key = format(new Date(trade.closed_at ?? trade.opened_at), "yyyy-MM-dd");
      byDay.set(key, (byDay.get(key) ?? 0) + (trade.net_pnl ?? 0));
    }
    return byDay;
  }, [closedTrades]);

  if (workspaceQuery.isLoading || !workspace) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading analytics…</p>;
  }

  return (
    <>
      <section className="mb-6 flex flex-col justify-between gap-4 border-b border-border pb-5 sm:flex-row sm:items-center">
        <h1 className="page-title">Analytics</h1>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <label htmlFor="min-sample-size">Min. sample size</label>
            <Input
              id="min-sample-size"
              type="number"
              min={1}
              max={100}
              value={minSampleSize}
              onChange={(e) => setMinSampleSize(Math.max(1, Number(e.target.value) || 1))}
              className="h-8 w-16 font-mono"
            />
          </div>
          <div className="period-switcher" role="tablist" aria-label="Date range">
            {RANGE_OPTIONS.map((option) => (
              <Button
                key={option.label}
                variant={!hasCustomRange && rangeDays === option.days ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  setRangeDays(option.days);
                  setCustomRange({ from: "", to: "" });
                }}
                role="tab"
                aria-selected={!hasCustomRange && rangeDays === option.days}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <DateRangePicker
            from={customRange.from}
            to={customRange.to}
            onChange={setCustomRange}
            placeholder="Custom range"
            className="h-8 w-auto"
          />
        </div>
      </section>

      {tradesQuery.isLoading ? (
        <div className="surface-panel py-16 text-center text-sm text-muted-foreground">Loading analytics…</div>
      ) : closedTrades.length === 0 ? (
        <div className="surface-panel py-16 text-center text-sm text-muted-foreground">
          No closed trades in this range yet.
        </div>
      ) : (
        <>
          {insights.length > 0 && (
            <div className="mb-6">
              <InsightCards insights={insights} />
            </div>
          )}

          <section className="metric-grid mb-6" aria-label="Overall performance">
            <MetricCard
              label="Net P&L"
              value={`${overall.netPnl >= 0 ? "" : "−"}$${Math.abs(overall.netPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
              change={`${closedTrades.length} closed`}
              detail="in range"
              positive={overall.netPnl >= 0}
              icon={<Wallet />}
            />
            <MetricCard
              label="Profit factor"
              value={overall.profitFactor === Infinity ? "∞" : overall.profitFactor ? overall.profitFactor.toFixed(2) : "—"}
              change={`${overall.winRate ?? 0}%`}
              detail="win rate"
              positive
              icon={<Percent />}
            />
            <MetricCard
              label="Avg R"
              value={overall.averageRMultiple != null ? `${overall.averageRMultiple >= 0 ? "+" : ""}${overall.averageRMultiple.toFixed(2)}R` : "—"}
              change={`$${(overall.averageWin ?? 0).toFixed(0)} / $${(overall.averageLoss ?? 0).toFixed(0)}`}
              detail="avg win / avg loss"
              positive={(overall.averageRMultiple ?? 0) >= 0}
              icon={<TrendingUp />}
            />
            <MetricCard
              label="Max drawdown"
              value={overall.hasEnoughDataForDrawdown ? `-${(overall.maxDrawdownPercent ?? 0).toFixed(1)}%` : "—"}
              change={overall.hasEnoughDataForDrawdown ? "of equity" : "need 5+"}
              detail="peak to trough"
              positive={(overall.maxDrawdownPercent ?? 0) < 5}
              icon={<TrendingDown />}
            />
          </section>

          <section className="surface-panel mb-6">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Balance</p>
                <h2 className="panel-title">Equity curve</h2>
              </div>
              <p className="text-xs text-muted-foreground">Click a point to open that trade</p>
            </div>
            <EquityCurveChart
              points={equityCurve.points}
              polyline={equityCurve.polyline}
              labels={equityCurve.labels}
              width={equityCurve.width}
              height={equityCurve.height}
            />
          </section>

          <section className="grid gap-6 mb-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="surface-panel space-y-5">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Process</p>
                  <h2 className="panel-title">Planned vs. realized</h2>
                </div>
              </div>
              <ComparisonBar
                label="Planned vs. realized R"
                left={{
                  label: "Planned",
                  value: ratioMetrics.averagePlannedR ?? 0,
                  display: ratioMetrics.averagePlannedR != null ? `${ratioMetrics.averagePlannedR.toFixed(2)}R` : "—",
                  tone: "neutral",
                }}
                right={{
                  label: "Realized",
                  value: ratioMetrics.averageRealizedR ?? 0,
                  display: ratioMetrics.averageRealizedR != null ? `${ratioMetrics.averageRealizedR.toFixed(2)}R` : "—",
                  tone:
                    ratioMetrics.averagePlannedR == null ||
                    ratioMetrics.averageRealizedR == null ||
                    ratioMetrics.averageRealizedR >= ratioMetrics.averagePlannedR
                      ? "positive"
                      : "negative",
                }}
              />
              <ComparisonBar
                label="Avg winner vs. loser (R)"
                left={{
                  label: "Winners",
                  value: ratioMetrics.averageWinnerR ?? 0,
                  display: ratioMetrics.averageWinnerR != null ? `${ratioMetrics.averageWinnerR.toFixed(2)}R` : "—",
                  tone: "positive",
                }}
                right={{
                  label: "Losers",
                  value: Math.abs(ratioMetrics.averageLoserR ?? 0),
                  display: ratioMetrics.averageLoserR != null ? `${ratioMetrics.averageLoserR.toFixed(2)}R` : "—",
                  tone: "negative",
                }}
              />
            </div>

            <div className="metric-grid">
              <MetricCard
                label="Payoff ratio"
                value={ratioMetrics.payoffRatio != null ? ratioMetrics.payoffRatio.toFixed(2) : "—"}
                change="avg win ÷ avg loss ($)"
                detail="above 1 means winners outsize losers"
                positive={(ratioMetrics.payoffRatio ?? 0) >= 1}
                icon={<Percent />}
              />
              <MetricCard
                label="Recovery factor"
                value={ratioMetrics.recoveryFactor != null ? ratioMetrics.recoveryFactor.toFixed(2) : "—"}
                change="net P&L ÷ max drawdown"
                detail="higher recovers drawdowns faster"
                positive={(ratioMetrics.recoveryFactor ?? 0) >= 1}
                icon={<TrendingDown />}
              />
            </div>
          </section>

          <section className="mb-6">
            <RDistributionChart buckets={rDistribution} />
          </section>

          <section className="surface-panel mb-6">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Habit</p>
                <h2 className="panel-title">Daily P&L</h2>
              </div>
              <p className="text-xs text-muted-foreground">Click a day to see its trades</p>
            </div>
            <PnlHeatmap
              pnlByDay={pnlByDay}
              start={rangeStart}
              end={rangeEnd}
              onSelectDay={(iso) => void navigate({ to: "/app/journal", search: { from: iso, to: iso } })}
            />
          </section>

          <SessionBreakdownPanel groups={sessionGroups} />

          <section className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="surface-panel space-y-4">
              <p className="eyebrow">Curated vs. Impulse</p>
              <ComparisonBar
                label="Trades"
                left={{ label: "Curated", value: curatedOnly.tradeCount, display: String(curatedOnly.tradeCount), tone: "positive" }}
                right={{ label: "Impulse", value: impulseOnly.tradeCount, display: String(impulseOnly.tradeCount), tone: "negative" }}
              />
              <ComparisonBar
                label="Win rate"
                left={{ label: "Curated", value: curatedOnly.winRate ?? 0, display: `${curatedOnly.winRate ?? "—"}%`, tone: "positive" }}
                right={{ label: "Impulse", value: impulseOnly.winRate ?? 0, display: `${impulseOnly.winRate ?? "—"}%`, tone: "negative" }}
              />
              <ComparisonBar
                label="Avg R multiple"
                left={{
                  label: "Curated",
                  value: curatedOnly.averageRMultiple ?? 0,
                  display: curatedOnly.averageRMultiple != null ? `${curatedOnly.averageRMultiple.toFixed(2)}R` : "—",
                  tone: "positive",
                }}
                right={{
                  label: "Impulse",
                  value: impulseOnly.averageRMultiple ?? 0,
                  display: impulseOnly.averageRMultiple != null ? `${impulseOnly.averageRMultiple.toFixed(2)}R` : "—",
                  tone: "negative",
                }}
              />
            </div>
            <div className="surface-panel space-y-4">
              <p className="eyebrow">&nbsp;</p>
              <ComparisonBar
                label="Expectancy per trade"
                left={{ label: "Curated", value: curatedOnly.expectancy ?? 0, display: `$${(curatedOnly.expectancy ?? 0).toFixed(0)}`, tone: "positive" }}
                right={{ label: "Impulse", value: impulseOnly.expectancy ?? 0, display: `$${(impulseOnly.expectancy ?? 0).toFixed(0)}`, tone: "negative" }}
              />
              <ComparisonBar
                label="Net P&L"
                left={{ label: "Curated", value: curatedOnly.netPnl, display: `$${curatedOnly.netPnl.toFixed(0)}`, tone: "positive" }}
                right={{ label: "Impulse", value: impulseOnly.netPnl, display: `$${impulseOnly.netPnl.toFixed(0)}`, tone: "negative" }}
              />
            </div>
          </section>

          <section className="mt-6">
            <BreakdownExplorer
              dimension={dimension}
              onDimensionChange={setDimension}
              groups={breakdownGroups}
              minSampleSize={minSampleSize}
            />
          </section>

          <section className="mt-6">
            <StreakDistributionCard distribution={streakDistribution} />
          </section>
        </>
      )}
    </>
  );
}
