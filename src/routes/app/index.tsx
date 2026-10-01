// Dashboard overview ("/app"): equity curve, open-risk gauge, and the
// Curated-vs-Impulse signal panel — the app's core MVP thesis (a trader can
// see, at a glance, whether their planned trades are actually outperforming
// their impulsive ones). Deeper breakdowns by setup/symbol/session/etc. live
// on the Analytics page (see analytics.tsx and lib/analytics.ts).
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CircleHelp,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { overviewQueryOptions, workspaceQueryOptions } from "@/lib/queries";
import { summarizeClosedTrades } from "@/lib/trade-calc";
import { buildEquityCurve } from "@/lib/equity-curve";
import { formatMoney, formatSignedMoney, workspaceCurrency } from "@/lib/money";
import { ComparisonRow, MetricCard } from "@/components/journal/dashboard-widgets";
import { EquityCurveChart } from "@/components/analytics/EquityCurveChart";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Overview — Curated Trades" },
      { name: "description", content: "Your trading journal at a glance: equity, risk, and Curated vs Impulse." },
    ],
  }),
  component: OverviewPage,
});


function OverviewPage() {
  const { data: workspace } = useQuery(workspaceQueryOptions);
  const startingEquity = workspace?.startingEquity ?? 50000;
  const currency = workspace ? workspaceCurrency(workspace) : "USD";

  // The server crunches the numbers beside the database and returns one small
  // report (overview-report.ts), so this page costs the same however many
  // trades the journal holds.
  const overviewQuery = useQuery(
    overviewQueryOptions(
      workspace
        ? { portfolioId: workspace.activePortfolio.id, accountId: workspace.activeAccount?.id, startingEquity, currency }
        : undefined,
    ),
  );
  const overview = overviewQuery.data;
  const analytics = overview?.analytics ?? summarizeClosedTrades([], startingEquity);
  const equityCurve = overview?.equityCurve ?? buildEquityCurve([], startingEquity, { currency });
  const closedCount = overview?.closedCount ?? 0;
  const openCount = overview?.openCount ?? 0;

  const curated = overview?.curated ?? { count: 0, wins: 0, netPnl: 0 };
  const impulse = overview?.impulse ?? { count: 0, wins: 0, netPnl: 0 };
  // The "5" threshold below (both here and in the insight banner's JSX) is a
  // fixed teaser value that intentionally matches Analytics' own default
  // minSampleSize (see analytics.tsx) so this dashboard doesn't tease an
  // insight that page wouldn't actually report yet. It's not read from
  // there — Analytics' threshold is user-adjustable and this one isn't —
  // so if that default ever changes, update this to match.
  const curatedRate = curated.count ? Math.round((curated.wins / curated.count) * 100) : 0;
  const impulseRate = impulse.count ? Math.round((impulse.wins / impulse.count) * 100) : 0;
  const signalScore = closedCount ? Math.min(99, Math.max(1, Math.round(50 + (curatedRate - impulseRate) / 2))) : 0;

  // Logging streak: consecutive days (ending today) with at least one trade
  // opened — a habit metric, distinct from win/loss streak. The server sends
  // when recent trades were opened; "which calendar day is that?" is answered
  // here, in the person's own local time zone.
  const daysWithTrades = new Set((overview?.recentOpenedAt ?? []).map((iso) => new Date(iso).toDateString()));
  let loggingStreak = 0;
  for (let i = 0; i < 30; i++) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    if (daysWithTrades.has(day.toDateString())) loggingStreak += 1;
    else if (i > 0) break;
  }

  const openRisk = overview?.openRisk ?? 0;
  const activeRiskPercent = workspace?.activeAccount?.default_risk_percent ?? workspace?.accounts[0]?.default_risk_percent ?? 1;
  const riskAllowance = workspace ? workspace.liveEquity * (activeRiskPercent / 100) * 3 : 1000;
  const riskPct = riskAllowance > 0 ? Math.min(100, Math.round((openRisk / riskAllowance) * 100)) : 0;

  const profileName = workspace?.profile.display_name || "Trader";

  if (!workspace) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading overview…</p>;
  }

  return (
    <>
      <section className="mb-8 flex flex-col justify-between gap-5 border-b border-border pb-6 md:flex-row md:items-end">
        <div>
          <h1 className="page-title">Good morning, {profileName.split(" ")[0]}</h1>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            {loggingStreak > 0
              ? `${loggingStreak}-day logging streak. Keep the process clean and let the data compound.`
              : "Log today's trades to start a streak."}
          </p>
        </div>
        <Link to="/app/journal">
          <Button>
            <Plus /> Log trade
          </Button>
        </Link>
      </section>

      <section className="metric-grid" aria-label="Performance summary">
        {!overview ? (
          <p className="col-span-full py-6 text-center text-sm text-muted-foreground">Loading your numbers…</p>
        ) : (
          <>
        <MetricCard
          label="Net P&L"
          value={formatSignedMoney(analytics.netPnl, currency)}
          change={`${closedCount} closed`}
          detail={openCount ? `${openCount} open` : "current journal"}
          positive={analytics.netPnl >= 0}
          icon={<Wallet />}
        />
        <MetricCard
          label="Win rate"
          value={closedCount ? `${analytics.winRate}%` : "—"}
          change={analytics.profitFactor === Infinity ? "∞" : analytics.profitFactor ? analytics.profitFactor.toFixed(2) : "—"}
          detail="profit factor"
          positive
          icon={<TrendingUp />}
        />
        <MetricCard
          label="Expectancy"
          value={
            closedCount
              ? formatSignedMoney(analytics.expectancy ?? 0, currency)
              : "—"
          }
          change={`${(analytics.averageRMultiple ?? 0) >= 0 ? "+" : ""}${(analytics.averageRMultiple ?? 0).toFixed(2)}R`}
          detail="avg per closed trade"
          positive={(analytics.expectancy ?? 0) >= 0}
          icon={<Target />}
        />
        <MetricCard
          label="Max drawdown"
          value={analytics.hasEnoughDataForDrawdown ? `-${(analytics.maxDrawdownPercent ?? 0).toFixed(1)}%` : "—"}
          change={analytics.hasEnoughDataForDrawdown ? "of equity" : "need 5+ trades"}
          detail={analytics.hasEnoughDataForDrawdown ? "peak to trough" : "not enough data yet"}
          positive={(analytics.maxDrawdownPercent ?? 0) < 5}
          icon={<ArrowDownRight />}
        />
          </>
        )}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(310px,0.85fr)]">
        <div className="surface-panel chart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Equity curve</p>
              <h2 className="panel-title">
                <span className="font-mono">{formatMoney(equityCurve.current, currency, 2)}</span>
              </h2>
            </div>
            <Link to="/app/analytics" className="text-xs text-muted-foreground hover:text-foreground">
              Full breakdown <ArrowUpRight className="inline size-3" />
            </Link>
          </div>
          <EquityCurveChart
            points={equityCurve.points}
            polyline={equityCurve.polyline}
            labels={equityCurve.labels}
            width={equityCurve.width}
            height={equityCurve.height}
          />
        </div>

        <div className="surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">The signal</p>
              <h2 className="panel-title">Curated vs. Impulse</h2>
            </div>
            <Link to="/app/analytics" className="text-xs text-muted-foreground hover:text-foreground">
              Full breakdown <ArrowUpRight className="inline size-3" />
            </Link>
          </div>
          <div className="signal-score">
            <div className="signal-ring">
              <span>{signalScore}</span>
              <small>score</small>
            </div>
            <div>
              <p className="text-sm font-semibold">{curatedRate >= impulseRate ? "Process is paying off" : "Process needs attention"}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {closedCount ? "Curated trades are compared with impulsive entries." : "Log your first trade to reveal your process signal."}
              </p>
            </div>
          </div>
          <div className="comparison-list">
            <ComparisonRow
              label="Curated"
              count={curated.count}
              winRate={curatedRate}
              result={formatMoney(curated.netPnl, currency)}
              positive
            />
            <ComparisonRow
              label="Impulse"
              count={impulse.count}
              winRate={impulseRate}
              result={formatMoney(impulse.netPnl, currency)}
            />
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(310px,0.85fr)]">
        <div className="surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Account health</p>
              <h2 className="panel-title">Risk at a glance</h2>
            </div>
            <Link to="/app/settings" className="text-xs text-muted-foreground hover:text-foreground">
              Adjust risk % <ArrowUpRight className="inline size-3" />
            </Link>
          </div>
          <div className="risk-item">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Open risk</span>
              <span className="font-mono font-semibold">
                {formatMoney(openRisk, currency)}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  / {formatMoney(riskAllowance, currency)}
                </span>
              </span>
            </div>
            <div className="progress-track">
              <span className="progress-fill" style={{ width: `${riskPct}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {openCount} open position{openCount === 1 ? "" : "s"}, {riskPct}% of risk allowance
              (3× your {activeRiskPercent}% per-trade risk, so roughly three full-risk positions at once)
            </p>
          </div>
          <div className="mt-6 flex items-start gap-3 border-t border-border pt-5">
            <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-5 text-muted-foreground">
              {loggingStreak > 0 ? (
                <>
                  You've logged trades <span className="font-semibold text-foreground">{loggingStreak} day{loggingStreak === 1 ? "" : "s"}</span> in a row.
                </>
              ) : (
                "No logging streak yet — add a trade today to start one."
              )}
            </p>
          </div>
        </div>

        <div className="insight-banner">
          <div className="insight-icon">
            <Sparkles />
          </div>
          <div className="min-w-0 flex-1">
            <p className="eyebrow text-chart-2">Insight</p>
            <p className="mt-1 text-sm font-medium">
              {curated.count >= 5 && impulse.count >= 5 ? (
                <>
                  Curated trades win <span className="text-chart-2">{curatedRate}%</span> of the time versus{" "}
                  <span className="text-destructive">{impulseRate}%</span> for impulse entries.
                </>
              ) : (
                "Log at least five Curated and five Impulse trades to unlock your behavior insight."
              )}
            </p>
            <Link to="/app/analytics" className="mt-2 inline-block text-xs text-muted-foreground hover:text-foreground">
              See all insights <ArrowUpRight className="inline size-3" />
            </Link>
          </div>
        </div>
      </section>

      {!analytics.hasEnoughDataForDrawdown && (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <CircleHelp className="size-3.5" /> Drawdown and streak metrics unlock after 5 closed trades.
        </p>
      )}
    </>
  );
}
