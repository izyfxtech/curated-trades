// Server functions for trades. Every write recomputes P&L/R/risk fields via
// the shared calc layer server-side, so a stored trade's numbers are correct
// regardless of what the client sent — manual entry today, CSV import and
// broker sync later all funnel through the same math (see trade-calc.ts).
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { friendlyNotFoundError } from "@/lib/db-errors";
import { fetchAllRows } from "@/lib/paging";
import { buildTradesPageQuery } from "@/lib/trades-page-query";
import { DEFAULT_TRADE_PAGE_SIZE, tradeFilterSchema, tradeSortSchema } from "@/lib/trade-filters";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  buildSizingContext,
  getInstrumentSpec,
  isLegacyUnitQuantity,
  needsQuoteRate,
} from "@/lib/instruments";
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
  // Lots for forex/metals (1.00 = one standard lot), plain units for crypto and anything else.
  quantity: z.number().positive(),
  // Account-currency value of 1 unit of the pair's quote currency. Only needed
  // for crosses (EURGBP, GBPJPY…); see instruments.needsQuoteRate.
  quoteRate: z.number().positive().nullable().optional(),
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
export function buildTradePayload(
  data: TradeFields,
  accountCurrency: string,
): Database["public"]["Tables"]["trades"]["Insert"] {
  // Throws a readable error for a cross pair with no rate — surfaced in the UI.
  const sizing = buildSizingContext({ symbol: data.symbol, accountCurrency, quoteRate: data.quoteRate });
  const storesQuoteRate = needsQuoteRate(sizing.spec, sizing.accountCurrency);
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
    sizing,
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
    // Only written for crosses, so nothing extra is sent (or required of the
    // schema) for the common case.
    ...(storesQuoteRate ? { quote_rate: data.quoteRate ?? null } : {}),
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

/**
 * Confirms every accountId belongs to the caller AND to the given portfolio —
 * a trade group can't silently span portfolios. Returns each account's base
 * currency (id → ISO code), which lot sizing needs to convert P&L and risk.
 */
async function assertOwnsAccountsInPortfolio(
  supabase: SupabaseClient<Database>,
  userId: string,
  portfolioId: string,
  accountIds: string[],
): Promise<Map<string, string>> {
  const { data: owned, error } = await supabase
    .from("accounts")
    .select("id, base_currency")
    .eq("owner_id", userId)
    .eq("portfolio_id", portfolioId)
    .in("id", accountIds);
  if (error) throw new Error(error.message);
  const ownedIds = new Set((owned ?? []).map((row) => row.id));
  if (accountIds.some((id) => !ownedIds.has(id))) {
    throw new Error("One or more accounts weren't found in this portfolio");
  }
  return new Map((owned ?? []).map((row) => [row.id, row.base_currency]));
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

const listTradesSchema = z.object({
  portfolioId: z.string().uuid(),
  // Omitted (or undefined) means "All accounts" — every trade in the
  // portfolio, matching the workspace's own aggregate-scope semantics
  // (see WorkspaceData.activeAccount in portfolios.functions.ts).
  accountId: z.string().uuid().optional(),
  /** Only for callers that genuinely want a few rows (e.g. "does this account
   * have any trades?" asks for 1). Omitted = ALL trades, however many. */
  limit: z.number().int().positive().max(1000).optional(),
});

/** Every trade in the portfolio (or the newest `limit`), newest first.
 *
 * Used by the screens that compute over the whole history — Overview,
 * Analytics, Reviews, export. It used to cap at the newest 500 trades and
 * say nothing about it, which silently corrupted everything derived from it
 * once a journal grew past that (the equity curve starts from starting equity
 * and adds up only the trades it was handed). It now reads every row, in
 * pages (see lib/paging.ts). The Journal table does NOT use this — it has its
 * own server-side filtered/sorted/paged query, `listTradesPage` below. */
export const listTrades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(listTradesSchema)
  .handler(async ({ context, data }): Promise<TradeRow[]> => {
    // No separate ownership pre-check: the owner_id filter below plus RLS
    // means a foreign portfolioId just returns an empty list, which is a
    // secure and reasonable result — no need to pay for an extra round trip
    // to turn that into an error instead.
    const { supabase, userId } = context;

    const base = () => {
      let query = supabase.from("trades").select("*").eq("owner_id", userId).eq("portfolio_id", data.portfolioId);
      if (data.accountId) query = query.eq("account_id", data.accountId);
      // `id` tiebreaker keeps range paging stable for trades opened at the same instant.
      return query.order("opened_at", { ascending: false }).order("id", { ascending: false });
    };

    if (data.limit) {
      const { data: trades, error } = await base().limit(data.limit);
      if (error) throw new Error(error.message);
      return trades ?? [];
    }
    return fetchAllRows<TradeRow>((from, to) => base().range(from, to));
  });

export interface TradePageRow extends TradeRow {
  /** Ids of the tags on this trade. */
  tagIds: string[];
  attachmentCount: number;
  isReviewed: boolean;
}

export interface TradePage {
  rows: TradePageRow[];
  /** Rows matching the filters across ALL pages, not just this one. */
  total: number;
}

const listTradesPageSchema = tradeFilterSchema.merge(tradeSortSchema).extend({
  portfolioId: z.string().uuid(),
  accountId: z.string().uuid().optional(),
  /** Zero-based. */
  page: z.number().int().min(0).default(0),
  /** Up to 1,000 so "export everything that matches" can reuse this. */
  pageSize: z.number().int().min(1).max(1000).default(DEFAULT_TRADE_PAGE_SIZE),
});
export type ListTradesPageInput = z.input<typeof listTradesPageSchema>;

/** One page of the Journal: the database filters, sorts and slices, and only
 * that slice crosses the wire — so the Journal stays fast and complete at any
 * size instead of loading a capped list and filtering it in the browser.
 *
 * Tags, screenshots and reviews live in other tables, so they're filtered with
 * PostgREST embedded-resource joins: `!inner` keeps only trades that have a
 * matching child row, and `is.null` on the embed keeps only trades with none.
 * The per-row tag ids / screenshot count / reviewed flag come back in the same
 * request (no separate portfolio-wide "all tag links" / "all attachments"
 * lists, which were themselves silently capped at 1,000 rows). */
export const listTradesPage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(listTradesPageSchema)
  .handler(async ({ context, data }): Promise<TradePage> => {
    const { supabase, userId } = context;

    const from = data.page * data.pageSize;
    const { data: rows, error, count } = await buildTradesPageQuery(supabase, userId, data).range(from, from + data.pageSize - 1);
    if (error) throw new Error(error.message);

    const pageRows = ((rows ?? []) as unknown as Array<
      TradeRow & {
        trade_tags?: { tag_id: string }[] | null;
        trade_attachments?: { id: string }[] | null;
        // One-to-one with trades, so PostgREST returns an object (or null), not an array.
        trade_reviews?: { id: string } | { id: string }[] | null;
      } & Record<string, unknown>
    >).map((row): TradePageRow => {
      const { trade_tags, trade_attachments, trade_reviews, ...rest } = row;
      // Drop the filter-only join aliases from the row we hand back.
      for (const key of Object.keys(rest)) {
        if (key === "tag_any" || key === "shot_filter" || key === "review_filter" || key.startsWith("tag_all_")) {
          delete (rest as Record<string, unknown>)[key];
        }
      }
      return {
        ...(rest as TradeRow),
        tagIds: (trade_tags ?? []).map((link) => link.tag_id),
        attachmentCount: trade_attachments?.length ?? 0,
        isReviewed: Array.isArray(trade_reviews) ? trade_reviews.length > 0 : trade_reviews != null,
      };
    });

    return { rows: pageRows, total: count ?? pageRows.length };
  });

export interface TradeWithTagNames extends TradeRow {
  tagNames: string[];
  tagIds: string[];
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
      .select("tag_id, tags(name)")
      .eq("owner_id", userId)
      .eq("trade_id", data.tradeId);
    if (tagLinksError) throw new Error(tagLinksError.message);

    const tagNames = (tagLinks ?? [])
      .map((link) => (link.tags as { name: string } | null)?.name)
      .filter((name): name is string => Boolean(name));
    const tagIds = (tagLinks ?? []).map((link) => link.tag_id);

    return { ...trade, tagNames, tagIds };
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
    const rows = await fetchAllRows((from, to) => {
      let query = supabase.from("trade_tags").select("trade_id, tag_id, trades!inner(portfolio_id)").eq("owner_id", userId);
      if (data.portfolioId) {
        query = query.eq("trades.portfolio_id", data.portfolioId);
      }
      return query.order("trade_id").order("tag_id").range(from, to);
    });
    return rows.map((row) => ({ trade_id: row.trade_id, tag_id: row.tag_id }));
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
    const currencies = await assertOwnsAccountsInPortfolio(supabase, userId, data.portfolioId, data.accountIds);

    const tradeGroupId = crypto.randomUUID();
    const payloads = data.accountIds.map((accountId) => ({
      ...buildTradePayload({ ...data, accountId }, currencies.get(accountId) ?? "USD"),
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

    // Lot sizing converts P&L into the account's currency, so the account has
    // to be known (and owned) before the numbers can be derived. This also
    // replaces the old reliance on RLS alone for a foreign accountId.
    const currencies = await assertOwnsAccountsInPortfolio(supabase, userId, data.portfolioId, [data.accountId]);
    const payload = { ...buildTradePayload(data, currencies.get(data.accountId) ?? "USD"), owner_id: userId };

    // Before overwriting, note whether this is a pre-lots (v1) trade that was
    // stored in raw units: its partial-exit rows are in units too, and once the
    // trade is re-saved in lots they must follow or fills would never add up.
    const { data: existing, error: existingError } = await supabase
      .from("trades")
      .select("symbol, quantity, calculation_version")
      .eq("id", data.tradeId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (!existing) throw new Error("Trade not found");
    const wasLegacyUnits = isLegacyUnitQuantity({
      symbol: existing.symbol,
      quantity: existing.quantity,
      calculationVersion: existing.calculation_version,
    });

    // The .eq("owner_id", ...) filter means a wrong/foreign tradeId matches
    // zero rows (PGRST116 from .single()); if the payload's portfolioId isn't
    // the caller's, RLS's WITH CHECK rejects the write (42501). Either way we
    // land on the same "Trade not found" message.
    const { data: updated, error } = await supabase
      .from("trades")
      .update(payload)
      .eq("id", data.tradeId)
      .eq("owner_id", userId)
      .select("*")
      .single();
    if (error) throw friendlyNotFoundError(error, "Trade not found");

    if (wasLegacyUnits) {
      const contractSize = getInstrumentSpec(existing.symbol).contractSize;
      const { data: legacyExits, error: legacyExitsError } = await supabase
        .from("trade_exits")
        .select("id, quantity")
        .eq("trade_id", data.tradeId)
        .eq("owner_id", userId);
      if (legacyExitsError) throw new Error(legacyExitsError.message);
      for (const exit of legacyExits ?? []) {
        const { error: exitError } = await supabase
          .from("trade_exits")
          .update({ quantity: exit.quantity / contractSize })
          .eq("id", exit.id)
          .eq("owner_id", userId);
        if (exitError) throw new Error(exitError.message);
      }
    }

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
