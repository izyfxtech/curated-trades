// Server functions for trades. Every write recomputes P&L/R/risk fields via
// the shared calc layer server-side, so a stored trade's numbers are correct
// regardless of what the client sent — manual entry today, CSV import and
// broker sync later all funnel through the same math (see trade-calc.ts).
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { friendlyNotFoundError } from "@/lib/db-errors";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  CALCULATION_VERSION,
  calculateHoldingSeconds,
  calculateTrade,
  detectSessionFallback,
  guessMarket,
  type CuratedLabel,
  type ExitInput,
} from "@/lib/trade-calc";

type TradeRow = Database["public"]["Tables"]["trades"]["Row"];

const directionSchema = z.enum(["long", "short"]);
const tradeStatusSchema = z.enum(["open", "closed", "cancelled", "incomplete"]);

const tradeFieldsSchema = z.object({
  portfolioId: z.string().uuid(),
  accountId: z.string().uuid(),
  symbol: z.string().trim().min(1).max(20),
  direction: directionSchema,
  status: tradeStatusSchema,
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable().optional(),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive().nullable().optional(),
  quantity: z.number().positive(),
  stopLoss: z.number().positive().nullable().optional(),
  takeProfit: z.number().positive().nullable().optional(),
  fees: z.number().min(0).default(0),
  spreadCost: z.number().min(0).default(0),
  swapFunding: z.number().default(0),
  isPlanned: z.boolean().default(false),
  disciplineScore: z.number().int().min(1).max(5).nullable().optional(),
  confidence: z.number().int().min(1).max(5).nullable().optional(),
  playbookId: z.string().uuid().nullable().optional(),
  playbookSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  tagIds: z.array(z.string().uuid()).max(20).default([]),
});

function requireClosedTradeHasExit<T extends { status: string; exitPrice?: number | null | undefined; closedAt?: string | null | undefined }>(
  value: T,
  ctx: z.RefinementCtx,
) {
  if (value.status === "closed" && (value.exitPrice == null || !value.closedAt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Closed trades require an exit price and a closed-at timestamp.",
    });
  }
}

const createTradeSchema = tradeFieldsSchema
  .omit({ accountId: true })
  .extend({
    // One or more — the common case is one, but the same setup can be
    // taken on several accounts at once. Each becomes its own trade row
    // (position size and therefore P&L can differ per account) sharing one
    // trade_group_id, so behavioral stats (win rate, Curated vs Impulse)
    // can count it once regardless of how many accounts it ran on.
    accountIds: z.array(z.string().uuid()).min(1).max(10),
  })
  .superRefine(requireClosedTradeHasExit);
const updateTradeSchema = tradeFieldsSchema
  .extend({ tradeId: z.string().uuid() })
  .superRefine(requireClosedTradeHasExit);

type TradeFields = z.infer<typeof tradeFieldsSchema>;
/** Shape callers should build before invoking createTrade/updateTrade (also reused by the CSV import path). */
export type TradeInput = z.input<typeof tradeFieldsSchema>;

/** Shared derivation logic between create, update, and import — builds everything except owner/portfolio linkage. */
export function buildTradePayload(data: TradeFields): Database["public"]["Tables"]["trades"]["Insert"] {
  const isClosed = data.status === "closed";
  const exits: ExitInput[] =
    isClosed && data.exitPrice != null
      ? [{ exitPrice: data.exitPrice, quantity: data.quantity, fees: 0 }]
      : [];

  const calc = calculateTrade({
    direction: data.direction,
    entryPrice: data.entryPrice,
    quantity: data.quantity,
    entryFees: data.fees,
    spreadCost: data.spreadCost,
    swapFunding: data.swapFunding,
    stopLoss: data.stopLoss ?? null,
    takeProfit: data.takeProfit ?? null,
    exits,
  });

  const holdingSeconds =
    isClosed && data.closedAt ? calculateHoldingSeconds(data.openedAt, data.closedAt) : null;

  const curatedLabel: CuratedLabel = data.isPlanned ? "curated" : "impulse";

  return {
    owner_id: "", // overwritten by caller
    portfolio_id: data.portfolioId,
    account_id: data.accountId,
    symbol: data.symbol.toUpperCase(),
    market: guessMarket(data.symbol),
    direction: data.direction,
    status: data.status,
    source: "manual",
    opened_at: data.openedAt,
    closed_at: isClosed ? (data.closedAt ?? null) : null,
    entry_price: data.entryPrice,
    exit_price: isClosed ? (data.exitPrice ?? null) : null,
    quantity: data.quantity,
    stop_loss: data.stopLoss ?? null,
    take_profit: data.takeProfit ?? null,
    fees: data.fees,
    spread_cost: data.spreadCost,
    swap_funding: data.swapFunding,
    gross_pnl: calc.grossPnl,
    net_pnl: calc.netPnl,
    initial_risk: calc.initialRisk,
    planned_r_multiple: calc.plannedRMultiple,
    realized_r_multiple: calc.realizedRMultiple,
    move_percent: calc.movePercent,
    holding_seconds: holdingSeconds,
    outcome: calc.outcome,
    is_planned: data.isPlanned,
    discipline_score: data.disciplineScore ?? null,
    confidence: data.confidence ?? null,
    playbook_id: data.playbookId ?? null,
    playbook_snapshot: (data.playbookSnapshot ?? null) as Json,
    curated_label: curatedLabel,
    session: detectSessionFallback(data.openedAt),
    notes: data.notes ?? null,
    calculation_version: CALCULATION_VERSION,
  };
}

async function assertOwnsPortfolio(
  supabase: SupabaseClient<Database>,
  userId: string,
  portfolioId: string,
) {
  const { data: owned, error } = await supabase
    .from("portfolios")
    .select("id")
    .eq("id", portfolioId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!owned) throw new Error("Portfolio not found");
}

/** Confirms every accountId belongs to the caller AND to the given portfolio — a trade group can't silently span portfolios. */
async function assertOwnsAccountsInPortfolio(
  supabase: SupabaseClient<Database>,
  userId: string,
  portfolioId: string,
  accountIds: string[],
) {
  const { data: owned, error } = await supabase
    .from("accounts")
    .select("id")
    .eq("owner_id", userId)
    .eq("portfolio_id", portfolioId)
    .in("id", accountIds);
  if (error) throw new Error(error.message);
  const ownedIds = new Set((owned ?? []).map((row) => row.id));
  if (accountIds.some((id) => !ownedIds.has(id))) {
    throw new Error("One or more accounts weren't found in this portfolio");
  }
}

/** Replaces a trade's tag links wholesale — delete-then-insert is fine at this scale (max 20 tags/trade). */
async function syncTradeTags(
  supabase: SupabaseClient<Database>,
  userId: string,
  tradeId: string,
  tagIds: string[],
) {
  const { error: deleteError } = await supabase
    .from("trade_tags")
    .delete()
    .eq("trade_id", tradeId)
    .eq("owner_id", userId);
  if (deleteError) throw new Error(deleteError.message);
  if (tagIds.length === 0) return;

  const rows = tagIds.map((tagId) => ({ trade_id: tradeId, tag_id: tagId, owner_id: userId }));
  const { error: insertError } = await supabase.from("trade_tags").insert(rows);
  if (insertError) throw new Error(insertError.message);
}

export { assertOwnsPortfolio, assertOwnsAccountsInPortfolio };

// Single source of truth for "how many trades a page fetches by default".
// This used to be inconsistent across callers — several pages passed
// `limit: 500` explicitly, one (the dashboard) passed nothing and silently
// got a different default — while every one of them shared the exact same
// TanStack Query cache key (`["trades", portfolioId, ...]`). Since Query
// dedupes purely by key, whichever page happened to load first within the
// cache's staleTime "won", and the others silently rendered however many
// rows that page had asked for — trades could appear to vanish from the
// Journal for up to 30 seconds after visiting the Dashboard. Every caller
// now imports this constant, requests it explicitly, and includes it in
// the query key (see each route's tradesQuery) so a future mismatch fails
// to compile instead of silently corrupting the cache again.
export const TRADES_LIST_DEFAULT_LIMIT = 500;

const listTradesSchema = z.object({
  portfolioId: z.string().uuid(),
  // Omitted (or undefined) means "All accounts" — every trade in the
  // portfolio, matching the workspace's own aggregate-scope semantics
  // (see WorkspaceData.activeAccount in portfolios.functions.ts).
  accountId: z.string().uuid().optional(),
  limit: z.number().int().positive().max(TRADES_LIST_DEFAULT_LIMIT).optional(),
});

export const listTrades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(listTradesSchema)
  .handler(async ({ context, data }): Promise<TradeRow[]> => {
    // No separate ownership pre-check: the owner_id filter below plus RLS
    // means a foreign portfolioId just returns an empty list, which is a
    // secure and reasonable result — no need to pay for an extra round trip
    // to turn that into an error instead.
    const { supabase, userId } = context;

    let query = supabase
      .from("trades")
      .select("*")
      .eq("owner_id", userId)
      .eq("portfolio_id", data.portfolioId);
    if (data.accountId) {
      query = query.eq("account_id", data.accountId);
    }
    const { data: trades, error } = await query
      .order("opened_at", { ascending: false })
      .limit(data.limit ?? TRADES_LIST_DEFAULT_LIMIT);
    if (error) throw new Error(error.message);
    return trades ?? [];
  });

export interface TradeWithTagNames extends TradeRow {
  tagNames: string[];
}

/** One trade plus its tag names, for the trade detail page ("/app/journal/$tradeId") —
 * a standalone URL someone can bookmark/refresh directly, so unlike the
 * Journal table (which already has every trade loaded in bulk) this can't
 * assume anything is in cache and fetches for itself.
 */
export const getTrade = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ tradeId: z.string().uuid() }))
  .handler(async ({ context, data }): Promise<TradeWithTagNames> => {
    const { supabase, userId } = context;

    const { data: trade, error } = await supabase
      .from("trades")
      .select("*")
      .eq("id", data.tradeId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!trade) throw new Error("Trade not found");

    const { data: tagLinks, error: tagLinksError } = await supabase
      .from("trade_tags")
      .select("tags(name)")
      .eq("owner_id", userId)
      .eq("trade_id", data.tradeId);
    if (tagLinksError) throw new Error(tagLinksError.message);

    const tagNames = (tagLinks ?? [])
      .map((link) => (link.tags as { name: string } | null)?.name)
      .filter((name): name is string => Boolean(name));

    return { ...trade, tagNames };
  });

export interface TradeTagLink {
  trade_id: string;
  tag_id: string;
}

/** Flat trade_id -> tag_id links for the caller's trades, for the client to join against listTags().
 * Scoped by portfolioId via an embedded-resource filter (trade_tags has no
 * portfolio_id column of its own) rather than fetching every tag-link the
 * owner has ever created across every portfolio.
 */
export const listTradeTagLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ portfolioId: z.string().uuid().optional() }))
  .handler(async ({ context, data }): Promise<TradeTagLink[]> => {
    const { supabase, userId } = context;
    let query = supabase.from("trade_tags").select("trade_id, tag_id, trades!inner(portfolio_id)").eq("owner_id", userId);
    if (data.portfolioId) {
      query = query.eq("trades.portfolio_id", data.portfolioId);
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((row) => ({ trade_id: row.trade_id, tag_id: row.tag_id }));
  });

export const createTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(createTradeSchema)
  .handler(async ({ context, data }): Promise<TradeRow[]> => {
    const { supabase, userId } = context;

    // Explicit pre-check here (unlike the single-account path below, which
    // relies on RLS to reject a foreign portfolioId) because inserting N
    // rows means a partial failure partway through would leave an orphaned
    // half-group — cheaper to confirm every account up front than to clean
    // up a partial insert after the fact.
    await assertOwnsAccountsInPortfolio(supabase, userId, data.portfolioId, data.accountIds);

    const tradeGroupId = crypto.randomUUID();
    const payloads = data.accountIds.map((accountId) => ({
      ...buildTradePayload({ ...data, accountId }),
      owner_id: userId,
      trade_group_id: tradeGroupId,
    }));

    const { data: created, error } = await supabase.from("trades").insert(payloads).select("*");
    if (error) throw friendlyNotFoundError(error, "Account not found");

    await Promise.all(created.map((trade) => syncTradeTags(supabase, userId, trade.id, data.tagIds)));
    return created;
  });

export const updateTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(updateTradeSchema)
  .handler(async ({ context, data }): Promise<TradeRow> => {
    const { supabase, userId } = context;
    const payload = { ...buildTradePayload(data), owner_id: userId };

    // Collapsed from three sequential round trips (assert portfolio owned,
    // select the trade to confirm it exists, then update) to one. The
    // .eq("owner_id", ...) filter means a wrong/foreign tradeId matches zero
    // rows (PGRST116 from .single()); if the payload's portfolioId isn't the
    // caller's, RLS's WITH CHECK rejects the write (42501). Either way we
    // land on the same "Trade not found" message as before.
    const { data: updated, error } = await supabase
      .from("trades")
      .update(payload)
      .eq("id", data.tradeId)
      .eq("owner_id", userId)
      .select("*")
      .single();
    if (error) throw friendlyNotFoundError(error, "Trade not found");

    await syncTradeTags(supabase, userId, data.tradeId, data.tagIds);
    return updated;
  });

const deleteTradeSchema = z.object({ tradeId: z.string().uuid() });

export const deleteTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(deleteTradeSchema)
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("trades")
      .delete()
      .eq("id", data.tradeId)
      .eq("owner_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
