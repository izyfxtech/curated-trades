// Public, unauthenticated server functions behind a coach share link
// (Phase 2.5). No requireSupabaseAuth middleware — there is no logged-in
// user on this path at all, just whoever has the token. Every handler here
// therefore reaches the database through the service-role client
// (supabaseAdmin), dynamically imported inside the handler per the
// convention in client.server.ts, and does its own token/expiry/revocation
// checks up front since RLS can't help on this path (see the migration
// comment in 20260911093000_phase2_5_coach_shares.sql for why that's
// deliberate). Every query below filters by BOTH share.portfolio_id AND
// share.owner_id together — never portfolio_id alone — so a share row that
// somehow pointed at the wrong portfolio could never leak another owner's
// trades; owner_id is the source of truth everywhere else in this schema
// and it stays that way here too.
import { createServerFn } from "@tanstack/react-start";
import Decimal from "decimal.js";
import { z } from "zod";

import { summarizeClosedTrades, type AnalyticsSummary, type ClosedTradeForAnalytics } from "@/lib/trade-calc";
import type { Database } from "@/integrations/supabase/types";

type CoachShareRow = Database["public"]["Tables"]["coach_shares"]["Row"];

async function loadValidShare(token: string): Promise<CoachShareRow> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: share, error } = await supabaseAdmin.from("coach_shares").select("*").eq("token", token).maybeSingle();
  if (error) throw new Error(error.message);
  if (!share) throw new Error("This link is invalid.");
  if (share.revoked_at != null) throw new Error("This link has been revoked.");
  if (share.expires_at != null && new Date(share.expires_at).getTime() < Date.now()) throw new Error("This link has expired.");
  return share;
}

export interface SharedTradeRow {
  id: string;
  symbol: string;
  direction: string;
  curatedLabel: string;
  openedAt: string;
  closedAt: string | null;
  realizedRMultiple: number | null;
  netPnl: number | null;
}

export interface EquityCurvePoint {
  index: number;
  value: number;
}

export interface SharedComment {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface SharedReport {
  label: string;
  portfolioName: string;
  permission: string;
  hideDollarPnl: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  stats: AnalyticsSummary;
  equityCurve: EquityCurvePoint[];
  trades: SharedTradeRow[];
  comments: SharedComment[];
}

const tokenSchema = z.object({ token: z.string().min(1).max(64) });

export const getSharedReport = createServerFn({ method: "GET" })
  .validator(tokenSchema)
  .handler(async ({ data }): Promise<SharedReport> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const share = await loadValidShare(data.token);

    const { data: portfolio, error: portfolioError } = await supabaseAdmin
      .from("portfolios")
      .select("name, starting_equity")
      .eq("id", share.portfolio_id)
      .eq("owner_id", share.owner_id)
      .maybeSingle();
    if (portfolioError) throw new Error(portfolioError.message);
    if (!portfolio) throw new Error("This link is invalid.");

    let tradesQuery = supabaseAdmin
      .from("trades")
      .select("id, symbol, direction, curated_label, opened_at, closed_at, realized_r_multiple, net_pnl")
      .eq("owner_id", share.owner_id)
      .eq("portfolio_id", share.portfolio_id)
      .eq("status", "closed")
      .not("closed_at", "is", null)
      .order("closed_at", { ascending: true });
    if (share.period_start) tradesQuery = tradesQuery.gte("closed_at", share.period_start);
    if (share.period_end) tradesQuery = tradesQuery.lte("closed_at", `${share.period_end}T23:59:59.999Z`);
    const { data: trades, error: tradesError } = await tradesQuery;
    if (tradesError) throw new Error(tradesError.message);

    const closedTrades: ClosedTradeForAnalytics[] = (trades ?? []).map((t) => ({
      id: t.id,
      netPnl: t.net_pnl ?? 0,
      realizedRMultiple: t.realized_r_multiple,
      curatedLabel: t.curated_label as ClosedTradeForAnalytics["curatedLabel"],
      openedAt: t.opened_at,
      closedAt: t.closed_at,
    }));
    const rawStats = summarizeClosedTrades(closedTrades, portfolio.starting_equity);

    // Dollar-denominated figures are exactly what hide_dollar_pnl exists to
    // hold back. Ratios/percentages (win rate, profit factor, R multiples,
    // drawdown %) don't reveal account size on their own, so those stay.
    const stats: AnalyticsSummary = share.hide_dollar_pnl
      ? { ...rawStats, netPnl: 0, averageWin: null, averageLoss: null, expectancy: null, maxDrawdownDollars: null }
      : rawStats;

    // Equity curve: cumulative dollar balance normally, cumulative R-multiple
    // instead when dollars are hidden, so there's still a progress line to
    // look at without exposing account size.
    let running = new Decimal(share.hide_dollar_pnl ? 0 : portfolio.starting_equity);
    const equityCurve: EquityCurvePoint[] = [{ index: 0, value: running.toNumber() }];
    (trades ?? []).forEach((t, i) => {
      running = running.plus(share.hide_dollar_pnl ? (t.realized_r_multiple ?? 0) : (t.net_pnl ?? 0));
      equityCurve.push({ index: i + 1, value: running.toNumber() });
    });

    const { data: comments, error: commentsError } = await supabaseAdmin
      .from("coach_comments")
      .select("id, author_name, body, created_at")
      .eq("share_id", share.id)
      .order("created_at", { ascending: true });
    if (commentsError) throw new Error(commentsError.message);

    // Atomic at the database level (see migration
    // 20260912090000_atomic_share_view_increment.sql) — the previous version
    // read share.view_count above and wrote back share.view_count + 1 here,
    // which is a classic lost-update race if two views land close together.
    const { error: incrementError } = await supabaseAdmin.rpc("increment_share_view_count", { p_share_id: share.id });
    if (incrementError) throw new Error(incrementError.message);

    return {
      label: share.label,
      portfolioName: portfolio.name,
      permission: share.permission,
      hideDollarPnl: share.hide_dollar_pnl,
      periodStart: share.period_start,
      periodEnd: share.period_end,
      stats,
      equityCurve,
      trades: (trades ?? []).map((t) => ({
        id: t.id,
        symbol: t.symbol,
        direction: t.direction,
        curatedLabel: t.curated_label,
        openedAt: t.opened_at,
        closedAt: t.closed_at,
        realizedRMultiple: t.realized_r_multiple,
        netPnl: share.hide_dollar_pnl ? null : (t.net_pnl ?? 0),
      })),
      comments: (comments ?? []).map((c) => ({ id: c.id, authorName: c.author_name, body: c.body, createdAt: c.created_at })),
    };
  });

const addCommentSchema = z.object({
  token: z.string().min(1).max(64),
  authorName: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(2000),
});

export const addCoachComment = createServerFn({ method: "POST" })
  .validator(addCommentSchema)
  .handler(async ({ data }): Promise<SharedComment> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const share = await loadValidShare(data.token);
    if (share.permission !== "comment") throw new Error("This share link is read-only.");

    const { data: created, error } = await supabaseAdmin
      .from("coach_comments")
      .insert({ owner_id: share.owner_id, share_id: share.id, author_name: data.authorName, body: data.body })
      .select("id, author_name, body, created_at")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id, authorName: created.author_name, body: created.body, createdAt: created.created_at };
  });
