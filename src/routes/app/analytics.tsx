// Deeper analytics ("/app/analytics", Phase 2.3): overview metrics, ratio
// metrics, R-multiple distribution, the daily P&L heatmap, Curated vs.
// Impulse comparison, a breakdown explorer across every dimension the plan
// specifies (setup, symbol, session, day of week, emotion, mistake, etc. —
// see lib/analytics.ts), and streak distribution. Deterministic insight
// cards sit at the top — every single one traces to one of exactly three
// explicit rules in generateInsights() (lib/analytics.ts), not a statistical
// or AI-generated judgment call.
//
// The range, custom dates, minimum sample size and breakdown dimension all
// live in the URL (typed search params), so a view of the analytics can be
// bookmarked or shared and survives a refresh. The numbers themselves are not
// computed here: the server filters the trades in the database, runs the
// calculations beside it (analytics.functions.ts → lib/analytics-report.ts) and
// sends back one small finished report — so this page costs the same at 50
// trades or 50,000, and nothing is ever silently truncated.
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { startOfDay, subDays } from "date-fns";
import { Percent, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Input } from "@/components/ui/input";
import { analyticsReportQueryOptions, earliestTradeQueryOptions, workspaceQueryOptions } from "@/lib/queries";
import type { AnalyticsReport } from "@/lib/analytics-report";
import { formatMoney, formatSignedMoney, workspaceCurrency } from "@/lib/money";
import { MetricCard } from "@/components/journal/dashboard-widgets";
import { EquityCurveChart } from "@/components/analytics/EquityCurveChart";
import { ComparisonBar } from "@/components/analytics/ComparisonBar";
import { PnlHeatmap } from "@/components/analytics/PnlHeatmap";
import { SessionBreakdownPanel } from "@/components/analytics/SessionBreakdownPanel";
import { BreakdownExplorer } from "@/components/analytics/BreakdownExplorer";
import { RDistributionChart } from "@/components/analytics/RDistributionChart";
import { StreakDistributionCard } from "@/components/analytics/StreakDistributionCard";
import { InsightCards } from "@/components/analytics/InsightCards";
import { BREAKDOWN_DIMENSIONS, type BreakdownDimension } from "@/lib/analytics";

export const Route = createFileRoute("/app/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — Curated Trades" },
      { name: "description", content: "Deeper breakdowns: Curated vs Impulse, daily P&L, and performance over time." },
    ],
  }),
  validateSearch: z.object({
    /** Preset window in days; "all" = since the first trade. Default 30. */
    range: z.enum(["7", "30", "90", "all"]).optional(),
    /** A custom window; when either is set it wins over `range`. */
    from: z.string().optional(),
    to: z.string().optional(),
    min: z.number().int().min(1).max(100).optional(),
    by: z.enum(BREAKDOWN_DIMENSIONS.map((d) => d.value) as [string, ...string[]]).optional(),
  }),
  component: AnalyticsPage,
});

const RANGE_OPTIONS = [
  { label: "7D", value: "7", days: 7 },
  { label: "30D", value: "30", days: 30 },
  { label: "90D", value: "90", days: 90 },
  { label: "All", value: "all", days: null },
] as const;

function AnalyticsPage() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const { data: workspace } = useQuery(workspaceQueryOptions);
  const activePortfolioId = workspace?.activePortfolio.id;
  const currency = workspace ? workspaceCurrency(workspace) : "USD";

  const rangeValue = search.range ?? "30";
  const rangeDays = RANGE_OPTIONS.find((option) => option.value === rangeValue)?.days ?? null;
  const minSampleSize = search.min ?? 5;
  const dimension = (search.by ?? "setup") as BreakdownDimension;
  // A non-empty custom range always takes priority over the preset buttons —
  // set together, they'd disagree about what's selected, so picking a custom
  // range shows no preset as highlighted instead of highlighting one for a
  // range it no longer describes.
  const customRange = { from: search.from ?? "", to: search.to ?? "" };
  const hasCustomRange = customRange.from !== "" || customRange.to !== "";

  // The actual [start, end] window every chart/metric on this page filters
  // to, as local calendar days (the browser knows the person's time zone; the
  // server just receives the resulting instants).
  const accountId = workspace?.activeAccount?.id;
  const today = startOfDay(new Date());
  // Only the "All" range (or a custom range with no start) needs to know where
  // the journal begins — one cheap server lookup, not a download of every trade.
  const needsEarliest = hasCustomRange ? customRange.from === "" : rangeDays == null;
  const earliestQuery = useQuery({ ...earliestTradeQueryOptions(activePortfolioId, accountId), enabled: needsEarliest });
  const earliestTrade = earliestQuery.data ? startOfDay(new Date(earliestQuery.data)) : null;
  let rangeStart: Date;
  let rangeEnd: Date;
  if (hasCustomRange) {
    rangeStart = customRange.from ? startOfDay(new Date(customRange.from)) : (earliestTrade ?? today);
    rangeEnd = customRange.to ? startOfDay(new Date(customRange.to)) : today;
  } else if (rangeDays == null) {
    rangeStart = earliestTrade ?? subDays(today, 30);
    rangeEnd = today;
  } else {
    rangeStart = subDays(today, rangeDays - 1);
    rangeEnd = today;
  }

  const startingEquity = workspace?.startingEquity ?? 50000;
  const rangeReady = !needsEarliest || !earliestQuery.isPending;
  // The server filters, crunches and returns the finished report — see
  // analytics.functions.ts. Nothing here scales with the size of the journal.
  const reportQuery = useQuery(
    analyticsReportQueryOptions(
      workspace && rangeReady
        ? {
            portfolioId: workspace.activePortfolio.id,
            accountId,
            startingEquity,
            currency,
            rangeStart: rangeStart.toISOString(),
            rangeEnd: new Date(rangeEnd.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(), // inclusive of the end day
            minSampleSize,
            dimension,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }
        : undefined,
    ),
  );
  const report = reportQuery.data;

  if (!workspace) {
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
              onChange={(e) =>
                void navigate({ search: (prev) => ({ ...prev, min: Math.max(1, Number(e.target.value) || 1) }), replace: true })
              }
              className="h-8 w-16 font-mono"
            />
          </div>
          <div className="period-switcher" role="tablist" aria-label="Date range">
            {RANGE_OPTIONS.map((option) => (
              <Button
                key={option.label}
                variant={!hasCustomRange && rangeValue === option.value ? "secondary" : "ghost"}
                size="sm"
                onClick={() =>
                  void navigate({
                    search: (prev) => ({ ...prev, range: option.value, from: undefined, to: undefined }),
                    replace: true,
                  })
                }
                role="tab"
                aria-selected={!hasCustomRange && rangeValue === option.value}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <DateRangePicker
            from={customRange.from}
            to={customRange.to}
            onChange={({ from, to }) =>
              void navigate({ search: (prev) => ({ ...prev, from: from || undefined, to: to || undefined }), replace: true })
            }
            placeholder="Custom range"
            className="h-8 w-auto"
          />
        </div>
      </section>

      {!report ? (
        <div className="surface-panel py-16 text-center text-sm text-muted-foreground">Loading analytics…</div>
      ) : report.closedCount === 0 ? (
        <div className="surface-panel py-16 text-center text-sm text-muted-foreground">
          No closed trades in this range yet.
        </div>
      ) : (
        <div className={`transition-opacity ${reportQuery.isFetching ? "opacity-60" : ""}`} aria-busy={reportQuery.isFetching}>
          <ReportView
              report={report}
            currency={currency}
            dimension={dimension}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
          />
        </div>
      )}
    </>
  );
}

/** The report itself. Receives the finished numbers from the server, so it is
 * pure presentation — nothing here recomputes from trades. */
function ReportView({
  report,
  currency,
  dimension,
  rangeStart,
  rangeEnd,
}: {
  report: AnalyticsReport;
  currency: string;
  dimension: BreakdownDimension;
  rangeStart: Date;
  rangeEnd: Date;
}) {
  const navigate = Route.useNavigate();
  const { overall, ratioMetrics, equityCurve, insights, rDistribution, curatedOnly, impulseOnly, breakdownGroups, sessionGroups, streakDistribution } = report;
  const pnlByDay = new Map(report.pnlByDay);
  const minSampleSize = Route.useSearch({ select: (search) => search.min ?? 5 });
  return (
    <>
          {insights.length > 0 && (
            <div className="mb-6">
              <InsightCards insights={insights} />
            </div>
          )}

          <section className="metric-grid mb-6" aria-label="Overall performance">
            <MetricCard
              label="Net P&L"
              value={formatSignedMoney(overall.netPnl, currency)}
              change={`${report.closedCount} closed`}
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
              change={`${formatMoney(overall.averageWin ?? 0, currency)} / ${formatMoney(overall.averageLoss ?? 0, currency)}`}
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
              currency={currency}
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
              currency={currency}
              onSelectDay={(iso) => void navigate({ to: "/app/journal", search: { from: iso, to: iso } })}
            />
          </section>

          <SessionBreakdownPanel groups={sessionGroups} currency={currency} />

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
                left={{ label: "Curated", value: curatedOnly.expectancy ?? 0, display: formatMoney(curatedOnly.expectancy ?? 0, currency), tone: "positive" }}
                right={{ label: "Impulse", value: impulseOnly.expectancy ?? 0, display: formatMoney(impulseOnly.expectancy ?? 0, currency), tone: "negative" }}
              />
              <ComparisonBar
                label="Net P&L"
                left={{ label: "Curated", value: curatedOnly.netPnl, display: formatMoney(curatedOnly.netPnl, currency), tone: "positive" }}
                right={{ label: "Impulse", value: impulseOnly.netPnl, display: formatMoney(impulseOnly.netPnl, currency), tone: "negative" }}
              />
            </div>
          </section>

          <section className="mt-6">
            <BreakdownExplorer
              dimension={dimension}
              onDimensionChange={(by) => void navigate({ search: (prev) => ({ ...prev, by }), replace: true })}
              groups={breakdownGroups}
              minSampleSize={minSampleSize}
              currency={currency}
            />
          </section>

          <section className="mt-6">
            <StreakDistributionCard distribution={streakDistribution} />
          </section>
    </>
  );
}
