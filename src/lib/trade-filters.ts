// The shape of the Journal's filters and sort, shared by the server function
// that applies them (trades.functions.ts → listTradesPage) and the route that
// keeps them in the URL (routes/app/journal.tsx). Plain module, no server
// code, so both sides can import it.
import { z } from "zod";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const tradeFilterSchema = z.object({
  /** Symbol contains (case-insensitive). */
  q: z.string().max(40).optional(),
  status: z.enum(["open", "closed", "incomplete", "cancelled"]).optional(),
  /** Stored on the trade at save time from its net P&L. */
  outcome: z.enum(["win", "loss", "breakeven"]).optional(),
  label: z.enum(["curated", "impulse"]).optional(),
  direction: z.enum(["long", "short"]).optional(),
  session: z.enum(["London", "New York", "Asia"]).optional(),
  market: z.enum(["forex", "crypto"]).optional(),
  playbookId: z.string().uuid().optional(),
  tagIds: z.array(z.string().uuid()).max(20).optional(),
  /** With several tags selected: trade has ANY of them, or ALL of them. */
  tagMode: z.enum(["any", "all"]).optional(),
  /** Has at least one screenshot / has none. */
  screenshots: z.enum(["with", "without"]).optional(),
  /** Has a post-trade review / doesn't. */
  reviewState: z.enum(["reviewed", "unreviewed"]).optional(),
  /** Trade opened on or after / on or before this day (inclusive). */
  from: isoDay.optional(),
  to: isoDay.optional(),
});
export type TradeFilters = z.infer<typeof tradeFilterSchema>;

/** Sortable columns → the database column each one sorts on. */
export const TRADE_SORT_COLUMNS = {
  opened: "opened_at",
  closed: "closed_at",
  symbol: "symbol",
  direction: "direction",
  status: "status",
  session: "session",
  result: "net_pnl",
  r: "realized_r_multiple",
  label: "curated_label",
} as const;
export type TradeSortKey = keyof typeof TRADE_SORT_COLUMNS;
export const TRADE_SORT_KEYS = Object.keys(TRADE_SORT_COLUMNS) as [TradeSortKey, ...TradeSortKey[]];

export const tradeSortSchema = z.object({
  sort: z.enum(TRADE_SORT_KEYS).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});

export const TRADE_PAGE_SIZES = [25, 50, 100, 200] as const;
export const DEFAULT_TRADE_PAGE_SIZE = 50;

/** Number of filter fields currently narrowing the list (for the "Filters (3)" badge). */
export function countActiveFilters(filters: TradeFilters): number {
  return [
    filters.q?.trim(),
    filters.status,
    filters.outcome,
    filters.label,
    filters.direction,
    filters.session,
    filters.market,
    filters.playbookId,
    filters.tagIds?.length,
    filters.screenshots,
    filters.reviewState,
    filters.from || filters.to,
  ].filter(Boolean).length;
}
