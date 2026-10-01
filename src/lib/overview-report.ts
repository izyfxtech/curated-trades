// The Overview dashboard's numbers, as one pure function — run on the server
// (analytics.functions.ts) so the browser receives a small finished report
// instead of downloading every trade. Same principle as analytics-report.ts:
// the figures come from the same shared functions the rest of the app uses.
import { buildEquityCurve, downsampleEquityCurve, type EquityCurveResult } from "@/lib/equity-curve";
import type { Database } from "@/integrations/supabase/types";
import { summarizeClosedTrades, type AnalyticsSummary, type ClosedTradeForAnalytics } from "@/lib/trade-calc";

type TradeRow = Database["public"]["Tables"]["trades"]["Row"];

/** The only trade columns the Overview needs (everything else is left in the database). */
export const OVERVIEW_TRADE_COLUMNS =
  "id, symbol, status, net_pnl, realized_r_multiple, curated_label, opened_at, closed_at, initial_risk" as const;
export type OverviewTrade = Pick<
  TradeRow,
  "id" | "symbol" | "status" | "net_pnl" | "realized_r_multiple" | "curated_label" | "opened_at" | "closed_at" | "initial_risk"
>;

export interface LabelBreakdown {
  count: number;
  wins: number;
  netPnl: number;
}

export interface OverviewReport {
  analytics: AnalyticsSummary;
  closedCount: number;
  openCount: number;
  /** Sum of initial risk across open trades. */
  openRisk: number;
  curated: LabelBreakdown;
  impulse: LabelBreakdown;
  equityCurve: EquityCurveResult;
}

function breakdown(trades: OverviewTrade[]): LabelBreakdown {
  return {
    count: trades.length,
    wins: trades.filter((t) => (t.net_pnl ?? 0) > 0).length,
    netPnl: trades.reduce((sum, t) => sum + (t.net_pnl ?? 0), 0),
  };
}

export function computeOverviewReport(trades: OverviewTrade[], startingEquity: number, currency: string): OverviewReport {
  const closed = trades.filter((t) => t.status === "closed" && t.net_pnl != null);
  const open = trades.filter((t) => t.status === "open");
  const analyticsInput: ClosedTradeForAnalytics[] = closed.map((t) => ({
    id: t.id,
    netPnl: t.net_pnl ?? 0,
    realizedRMultiple: t.realized_r_multiple,
    curatedLabel: t.curated_label === "curated" ? "curated" : "impulse",
    openedAt: t.opened_at,
    closedAt: t.closed_at,
  }));

  return {
    analytics: summarizeClosedTrades(analyticsInput, startingEquity),
    closedCount: closed.length,
    openCount: open.length,
    openRisk: open.reduce((sum, t) => sum + (t.initial_risk ?? 0), 0),
    curated: breakdown(closed.filter((t) => t.curated_label === "curated")),
    impulse: breakdown(closed.filter((t) => t.curated_label === "impulse")),
    equityCurve: downsampleEquityCurve(
      buildEquityCurve(
        closed.map((t) => ({ id: t.id, symbol: t.symbol, netPnl: t.net_pnl, openedAt: t.opened_at, closedAt: t.closed_at })),
        startingEquity,
        { currency },
      ),
    ),
  };
}
