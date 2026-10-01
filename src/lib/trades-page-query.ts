// Builds the Supabase/PostgREST query behind the Journal's server-side
// filtering and sorting (see listTradesPage in trades.functions.ts). Kept as a
// plain function, apart from the server function, so the exact request it
// produces can be inspected and tested without a database.
//
// Tags, screenshots and reviews live in other tables, so they're filtered with
// PostgREST embedded-resource joins: `!inner` keeps only trades that have a
// matching child row, and `is.null` on the embed keeps only trades with none.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { TRADE_SORT_COLUMNS, type TradeFilters, type TradeSortKey } from "@/lib/trade-filters";

export interface TradesPageQueryInput extends TradeFilters {
  portfolioId: string;
  accountId?: string | undefined;
  sort?: TradeSortKey | undefined;
  dir?: "asc" | "desc" | undefined;
}

export function buildTradesPageQuery(supabase: SupabaseClient<Database>, userId: string, data: TradesPageQueryInput) {
  const tagIds = data.tagIds ?? [];
  const allTags = data.tagMode === "all" && tagIds.length > 1;

  // Row-data embeds: the per-row tag ids / screenshot count / reviewed flag.
  const embeds = ["trade_tags(tag_id)", "trade_attachments(id)", "trade_reviews(id)"];
  // Filter-only joins, aliased so they don't disturb the row-data embeds above.
  if (tagIds.length > 0 && !allTags) embeds.push("tag_any:trade_tags!inner(tag_id)");
  if (allTags) tagIds.forEach((_, i) => embeds.push(`tag_all_${i}:trade_tags!inner(tag_id)`));
  if (data.screenshots === "with") embeds.push("shot_filter:trade_attachments!inner(id)");
  if (data.reviewState === "reviewed") embeds.push("review_filter:trade_reviews!inner(id)");

  // The select string is assembled at runtime, which the client's type parser
  // can't follow; cast to "*" so the builder is typed as a trade row.
  let query = supabase
    .from("trades")
    .select(["*", ...embeds].join(", ") as "*", { count: "exact" })
    .eq("owner_id", userId)
    .eq("portfolio_id", data.portfolioId);

  if (data.accountId) query = query.eq("account_id", data.accountId);
  if (data.status) query = query.eq("status", data.status);
  if (data.outcome) query = query.eq("outcome", data.outcome);
  if (data.label) query = query.eq("curated_label", data.label);
  if (data.direction) query = query.eq("direction", data.direction);
  if (data.session) query = query.eq("session", data.session);
  if (data.market) query = query.eq("market", data.market);
  if (data.playbookId) query = query.eq("playbook_id", data.playbookId);

  // Strip characters that mean something inside an ilike pattern / filter string.
  const symbolQuery = data.q?.replace(/[%_,()\\*]/g, "").trim();
  if (symbolQuery) query = query.ilike("symbol", `%${symbolQuery}%`);

  if (data.from) query = query.gte("opened_at", new Date(data.from).toISOString());
  if (data.to) query = query.lte("opened_at", new Date(new Date(data.to).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString());

  if (tagIds.length > 0 && !allTags) query = query.in("tag_any.tag_id", tagIds);
  if (allTags) tagIds.forEach((tagId, i) => (query = query.eq(`tag_all_${i}.tag_id`, tagId)));
  if (data.screenshots === "without") query = query.is("trade_attachments", null);
  if (data.reviewState === "unreviewed") query = query.is("trade_reviews", null);

  return query
    .order(TRADE_SORT_COLUMNS[data.sort ?? "opened"], { ascending: (data.dir ?? "desc") === "asc", nullsFirst: false })
    // Unique tiebreaker so a page boundary never repeats or skips a row.
    .order("id", { ascending: false });
}
