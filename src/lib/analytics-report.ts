// The whole Analytics page's numbers, computed in one pure function.
//
// This used to run inside the page component, in the browser, over every trade
// the page had downloaded. It now runs on the server (analytics.functions.ts),
// next to the database, and the browser receives only the finished report —
// a few kilobytes whether the journal holds fifty trades or fifty thousand.
// It is deliberately a *move*, not a rewrite: every figure still comes from the
// same functions as before (summarizeClosedTrades, computeBreakdown,
// generateInsights, buildEquityCurve …), so there is no second copy of the
// maths to drift out of sync.
import {
  computeBreakdown,
  computeRDistribution,
  computeRatioMetrics,
  computeStreakDistribution,
  enrichTrades,
  generateInsights,
  type BreakdownDimension,
  type BreakdownGroup,
  type InsightCard,
  type RatioMetrics,
  type RBucket,
  type StreakDistribution,
} from "@/lib/analytics";
import { buildEquityCurve, downsampleEquityCurve, type EquityCurveResult } from "@/lib/equity-curve";
import type { Database } from "@/integrations/supabase/types";
import { summarizeClosedTrades, type AnalyticsSummary, type ClosedTradeForAnalytics } from "@/lib/trade-calc";

type TradeRow = Database["public"]["Tables"]["trades"]["Row"];
type TradeReviewRow = Database["public"]["Tables"]["trade_reviews"]["Row"];

export interface AnalyticsReportInput {
  /** Trades already narrowed to the date range being analysed. */
  trades: TradeRow[];
  reviews: TradeReviewRow[];
  tagLinks: { trade_id: string; tag_id: string }[];
  tags: { id: string; name: string; category: string }[];
  startingEquity: number;
  currency: string;
  minSampleSize: number;
  dimension: BreakdownDimension;
  /** IANA zone used to decide which calendar day a trade belongs to. */
  timeZone: string;
}

export interface AnalyticsReport {
  tradeCount: number;
  closedCount: number;
  overall: AnalyticsSummary;
  curatedOnly: AnalyticsSummary;
  impulseOnly: AnalyticsSummary;
  ratioMetrics: RatioMetrics;
  insights: InsightCard[];
  breakdownGroups: BreakdownGroup[];
  sessionGroups: BreakdownGroup[];
  rDistribution: RBucket[];
  streakDistribution: StreakDistribution;
  equityCurve: EquityCurveResult;
  /** Net P&L per calendar day ("yyyy-MM-dd" in `timeZone`), for the heatmap. */
  pnlByDay: [string, number][];
}

/** "2026-09-01" for the calendar day `iso` falls on in `timeZone`. */
export function dayKey(iso: string, timeZone: string): string {
  // The en-CA locale formats dates as yyyy-mm-dd.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function computeAnalyticsReport(input: AnalyticsReportInput): AnalyticsReport {
  const { trades, startingEquity, currency, minSampleSize, dimension } = input;
  const closedTrades = trades.filter((t) => t.status === "closed" && t.net_pnl != null);

  const enrichedTrades = enrichTrades(trades, input.reviews, input.tagLinks, input.tags);
  const analyticsInput: ClosedTradeForAnalytics[] = closedTrades.map((t) => ({
    id: t.id,
    netPnl: t.net_pnl ?? 0,
    realizedRMultiple: t.realized_r_multiple,
    curatedLabel: t.curated_label === "curated" ? "curated" : "impulse",
    openedAt: t.opened_at,
    closedAt: t.closed_at,
  }));
  const overall = summarizeClosedTrades(analyticsInput, startingEquity);

  const pnlByDay = new Map<string, number>();
  for (const trade of closedTrades) {
    const key = dayKey(trade.closed_at ?? trade.opened_at, input.timeZone);
    pnlByDay.set(key, (pnlByDay.get(key) ?? 0) + (trade.net_pnl ?? 0));
  }

  return {
    tradeCount: trades.length,
    closedCount: closedTrades.length,
    overall,
    curatedOnly: summarizeClosedTrades(analyticsInput.filter((t) => t.curatedLabel === "curated"), startingEquity),
    impulseOnly: summarizeClosedTrades(analyticsInput.filter((t) => t.curatedLabel === "impulse"), startingEquity),
    ratioMetrics: computeRatioMetrics(closedTrades, overall.netPnl, overall.maxDrawdownDollars),
    insights: generateInsights(enrichedTrades, startingEquity, minSampleSize, overall, currency),
    breakdownGroups: computeBreakdown(enrichedTrades, dimension, startingEquity, minSampleSize),
    sessionGroups: computeBreakdown(enrichedTrades, "session", startingEquity, 1),
    rDistribution: computeRDistribution(closedTrades),
    streakDistribution: computeStreakDistribution(closedTrades),
    equityCurve: downsampleEquityCurve(
      buildEquityCurve(
        closedTrades.map((t) => ({ id: t.id, symbol: t.symbol, netPnl: t.net_pnl, openedAt: t.opened_at, closedAt: t.closed_at })),
        startingEquity,
        { width: 900, height: 240, currency },
      ),
    ),
    pnlByDay: [...pnlByDay.entries()],
  };
}
