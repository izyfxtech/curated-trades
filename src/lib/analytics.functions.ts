// Server functions behind the Overview and Analytics screens.
//
// Both used to download every trade the portfolio has ever had and compute in
// the browser. That meant payload and CPU grew with the journal, and — until
// the silent 500-trade cap was removed — the numbers were quietly wrong for
// long-running journals. Now the work happens here, beside the database:
//   * rows are narrowed *in the database* (by date range, account, columns);
//   * the existing pure calculation code runs over them (analytics-report.ts,
//     overview-report.ts — a move, not a rewrite);
//   * the browser receives only the finished report.
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { BREAKDOWN_DIMENSIONS, type BreakdownDimension } from "@/lib/analytics";
import { computeAnalyticsReport, type AnalyticsReport } from "@/lib/analytics-report";
import { fetchAllRows } from "@/lib/paging";
import { computeOverviewReport, OVERVIEW_TRADE_COLUMNS, type OverviewReport, type OverviewTrade } from "@/lib/overview-report";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type TradeRow = Database["public"]["Tables"]["trades"]["Row"];
type TradeReviewRow = Database["public"]["Tables"]["trade_reviews"]["Row"];

const scopeSchema = z.object({
  portfolioId: z.string().uuid(),
  // Omitted = "All accounts".
  accountId: z.string().uuid().optional(),
  startingEquity: z.number().finite(),
  currency: z.string().min(1).max(8),
});

// ── Overview ───────────────────────────────────────────────────────────────

export interface OverviewData extends OverviewReport {
  /** When trades were opened over the last ~5 weeks — the browser turns these
   * into the logging streak using the person's own local calendar days. */
  recentOpenedAt: string[];
}

const STREAK_LOOKBACK_DAYS = 35;

type Db = SupabaseClient<Database>;
type ScopeInput = z.infer<typeof scopeSchema>;

/** Loads the Overview report. A plain function (the server function below is a
 * thin wrapper) so it can be run directly against a database in tests. */
export async function loadOverview(supabase: Db, userId: string, data: ScopeInput): Promise<OverviewData> {
  const trades = await fetchAllRows<OverviewTrade>((from, to) => {
    let query = supabase
      .from("trades")
      .select(OVERVIEW_TRADE_COLUMNS)
      .eq("owner_id", userId)
      .eq("portfolio_id", data.portfolioId);
    if (data.accountId) query = query.eq("account_id", data.accountId);
    return query.order("opened_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
  });

  const since = Date.now() - STREAK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  return {
    ...computeOverviewReport(trades, data.startingEquity, data.currency),
    recentOpenedAt: trades.filter((t) => new Date(t.opened_at).getTime() >= since).map((t) => t.opened_at),
  };
}

export const getOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(scopeSchema)
  .handler(({ context, data }) => loadOverview(context.supabase, context.userId, data));

// ── Analytics ──────────────────────────────────────────────────────────────

/** Date of the first trade ever opened, or null for an empty journal — the
 * "All" range needs it to know where "all" starts. One row, so it's cheap. */
export const getEarliestTradeDate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ portfolioId: z.string().uuid(), accountId: z.string().uuid().optional() }))
  .handler(async ({ context, data }): Promise<string | null> => {
    const { supabase, userId } = context;
    let query = supabase.from("trades").select("opened_at").eq("owner_id", userId).eq("portfolio_id", data.portfolioId);
    if (data.accountId) query = query.eq("account_id", data.accountId);
    const { data: rows, error } = await query.order("opened_at", { ascending: true }).limit(1);
    if (error) throw new Error(error.message);
    return rows?.[0]?.opened_at ?? null;
  });

const analyticsSchema = scopeSchema.extend({
  /** Inclusive window, as instants (the browser works out its own local-day boundaries). */
  rangeStart: z.string().datetime({ offset: true }),
  rangeEnd: z.string().datetime({ offset: true }),
  minSampleSize: z.number().int().min(1).max(100),
  dimension: z.enum(BREAKDOWN_DIMENSIONS.map((d) => d.value) as [string, ...string[]]),
  timeZone: z.string().min(1).max(64),
});
export type AnalyticsInput = z.input<typeof analyticsSchema>;
type AnalyticsParsed = z.infer<typeof analyticsSchema>;

/** Loads the Analytics report for a window. Plain function — see loadOverview. */
export async function loadAnalyticsReport(supabase: Db, userId: string, data: AnalyticsParsed): Promise<AnalyticsReport> {
    // Reject a time zone Intl doesn't know before it throws deep inside the report.
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: data.timeZone });
    } catch {
      throw new Error("Unknown time zone");
    }

    // Everything below is narrowed in the database to the window and scope, so
    // a one-month view of a ten-year journal reads one month of rows.
    const trades = await fetchAllRows<TradeRow>((from, to) => {
      let query = supabase
        .from("trades")
        .select("*")
        .eq("owner_id", userId)
        .eq("portfolio_id", data.portfolioId)
        .gte("opened_at", data.rangeStart)
        .lte("opened_at", data.rangeEnd);
      if (data.accountId) query = query.eq("account_id", data.accountId);
      return query.order("opened_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
    });

    // Reviews / tag links belong to trades, so they're narrowed by joining to
    // the same window rather than sending a (potentially enormous) id list.
    const reviews = await fetchAllRows<TradeReviewRow & { trades?: unknown }>((from, to) => {
      let query = supabase
        .from("trade_reviews")
        .select("*, trades!inner(portfolio_id, account_id, opened_at)")
        .eq("owner_id", userId)
        .eq("trades.portfolio_id", data.portfolioId)
        .gte("trades.opened_at", data.rangeStart)
        .lte("trades.opened_at", data.rangeEnd);
      if (data.accountId) query = query.eq("trades.account_id", data.accountId);
      return query.order("trade_id").range(from, to);
    }).then((rows) => rows.map(({ trades: _trades, ...row }) => row as unknown as TradeReviewRow));

    const tagLinks = await fetchAllRows<{ trade_id: string; tag_id: string }>((from, to) => {
      let query = supabase
        .from("trade_tags")
        .select("trade_id, tag_id, trades!inner(portfolio_id, account_id, opened_at)")
        .eq("owner_id", userId)
        .eq("trades.portfolio_id", data.portfolioId)
        .gte("trades.opened_at", data.rangeStart)
        .lte("trades.opened_at", data.rangeEnd);
      if (data.accountId) query = query.eq("trades.account_id", data.accountId);
      return query.order("trade_id").order("tag_id").range(from, to);
    }).then((rows) => rows.map(({ trade_id, tag_id }) => ({ trade_id, tag_id })));

    const { data: tags, error: tagsError } = await supabase.from("tags").select("id, name, category").eq("owner_id", userId);
    if (tagsError) throw new Error(tagsError.message);

    return computeAnalyticsReport({
      trades,
      reviews,
      tagLinks,
      tags: tags ?? [],
      startingEquity: data.startingEquity,
      currency: data.currency,
      minSampleSize: data.minSampleSize,
      dimension: data.dimension as BreakdownDimension,
      timeZone: data.timeZone,
    });
}

export const getAnalyticsReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(analyticsSchema)
  .handler(({ context, data }) => loadAnalyticsReport(context.supabase, context.userId, data));
