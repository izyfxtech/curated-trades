// The single home for every TanStack Query definition in the app. Before this
// existed, each route re-declared `{ queryKey, queryFn, enabled }` inline —
// the "trades" query alone was copy-pasted into five files, and invalidations
// re-typed the same string keys by hand. Now:
//   * one `queryOptions()` factory per query, so a route, a loader and an
//     invalidation all reference the *same* key and function;
//   * `skipToken` instead of `enabled` + `as string` casts — when an id isn't
//     known yet the query is inert, and the type system knows `id` is a
//     string inside the queryFn;
//   * the Supabase session is a query too (see `sessionQueryOptions`), which
//     is what lets auth live in router context instead of a React context.
import { keepPreviousData, queryOptions, skipToken } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { listAttachments, listAttachmentsForTrades } from "@/lib/attachments.functions";
import {
  getAnalyticsReport,
  getEarliestTradeDate,
  getOverview,
  type AnalyticsInput,
} from "@/lib/analytics.functions";
import { getWorkspace } from "@/lib/portfolios.functions";
import {
  listPlaybookAttachments,
  listPlaybooks,
} from "@/lib/playbooks.functions";
import { getComplianceOverview } from "@/lib/prop-firm.functions";
import { getSharedReport } from "@/lib/public-share.functions";
import {
  getTradeReview,
  listPeriodReviews,
  listTradeReviews,
  listTradesNeedingReview,
} from "@/lib/reviews.functions";
import { listCoachCommentsForOwner, listCoachShares } from "@/lib/shares.functions";
import { listTags } from "@/lib/tags.functions";
import { listTradeExits } from "@/lib/trade-exits.functions";
import { listTradeIdeas } from "@/lib/trade-ideas.functions";
import {
  getTrade,
  listTrades,
  listTradesPage,
  listTradeTagLinks,
  type ListTradesPageInput,
} from "@/lib/trades.functions";

// ── Auth ───────────────────────────────────────────────────────────────────

/** The Supabase session, as a query. Seeded on first use from
 * `getSession()` and afterwards kept current by the single
 * `onAuthStateChange` subscription in router.tsx, which writes straight into
 * this cache — so `staleTime: Infinity` (it is never refetched, only pushed).
 * Route guards read it in `beforeLoad` via `ensureQueryData`; components read
 * it with `useQuery`/`useSuspenseQuery`. */
export const sessionQueryOptions = queryOptions({
  queryKey: ["auth", "session"] as const,
  queryFn: async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  },
  staleTime: Infinity,
  // The browser holds the session in localStorage; a server render has none
  // to read, so never fire this during SSR.
  enabled: !import.meta.env.SSR,
});

// ── Workspace ──────────────────────────────────────────────────────────────

export const workspaceQueryOptions = queryOptions({
  queryKey: ["workspace"] as const,
  queryFn: () => getWorkspace(),
});

// ── Trades ─────────────────────────────────────────────────────────────────

/** EVERY trade in the portfolio/account, newest first — for the screens that
 * compute over the whole history (Overview, Analytics, Reviews, exports). The
 * Journal table uses `tradesPageQueryOptions` instead. */
export const tradesQueryOptions = (portfolioId: string | undefined, accountId: string | undefined) =>
  queryOptions({
    queryKey: ["trades", portfolioId, accountId, "all"] as const,
    queryFn: portfolioId ? () => listTrades({ data: { portfolioId, accountId } }) : skipToken,
  });

/** One server-filtered, server-sorted page of the Journal. Every input that
 * changes the result is in the key (so each filter/sort/page is its own cache
 * entry), and `keepPreviousData` holds the old page on screen while the next
 * one loads instead of flashing an empty table. The key starts with
 * ["trades", portfolioId] so saving or deleting a trade (which invalidates
 * that prefix) refreshes the open page too. */
export const tradesPageQueryOptions = (params: ListTradesPageInput | undefined) =>
  queryOptions({
    queryKey: ["trades", params?.portfolioId, "page", params] as const,
    queryFn: params ? () => listTradesPage({ data: params }) : skipToken,
    placeholderData: keepPreviousData,
  });

export const tradeDetailQueryOptions = (tradeId: string) =>
  queryOptions({
    queryKey: ["trade-detail", tradeId] as const,
    queryFn: () => getTrade({ data: { tradeId } }),
  });

export const tradeTagLinksQueryOptions = (portfolioId: string | undefined) =>
  queryOptions({
    queryKey: ["trade-tag-links", portfolioId] as const,
    queryFn: portfolioId ? () => listTradeTagLinks({ data: { portfolioId } }) : skipToken,
  });

export const tradeExitsQueryOptions = (tradeId: string) =>
  queryOptions({
    queryKey: ["trade-exits", tradeId] as const,
    queryFn: () => listTradeExits({ data: { tradeId } }),
  });

/** `listTrades` with `limit: 1` — used only to answer "does this account
 * have any trades yet?" (which gates editing its starting equity). */
export const tradeExistsQueryOptions = (accountId: string, portfolioId: string) =>
  queryOptions({
    queryKey: ["trade-exists", accountId] as const,
    queryFn: () => listTrades({ data: { portfolioId, accountId, limit: 1 } }),
  });

// ── Computed reports (Overview, Analytics) ────────────────────────────────
// The server does the number-crunching beside the database and sends back a
// small finished report, so these screens cost the same however big the
// journal is. Keys start with ["trades", portfolioId] so that logging, editing
// or deleting a trade (which invalidates that prefix) refreshes them too.

type OverviewScope = { portfolioId: string; accountId: string | undefined; startingEquity: number; currency: string };

export const overviewQueryOptions = (scope: OverviewScope | undefined) =>
  queryOptions({
    queryKey: ["trades", scope?.portfolioId, "overview", scope] as const,
    queryFn: scope ? () => getOverview({ data: scope }) : skipToken,
    placeholderData: keepPreviousData,
  });

export const earliestTradeQueryOptions = (portfolioId: string | undefined, accountId: string | undefined) =>
  queryOptions({
    queryKey: ["trades", portfolioId, "earliest", accountId] as const,
    queryFn: portfolioId ? () => getEarliestTradeDate({ data: { portfolioId, accountId } }) : skipToken,
  });

export const analyticsReportQueryOptions = (input: AnalyticsInput | undefined) =>
  queryOptions({
    queryKey: ["trades", input?.portfolioId, "analytics", input] as const,
    queryFn: input ? () => getAnalyticsReport({ data: input }) : skipToken,
    // Changing the range or breakdown keeps the previous report on screen
    // (dimmed) instead of blanking the page while the next one loads.
    placeholderData: keepPreviousData,
  });

// ── Tags, playbooks, ideas ─────────────────────────────────────────────────

export const tagsQueryOptions = queryOptions({
  queryKey: ["tags"] as const,
  queryFn: () => listTags(),
});

export const playbooksQueryOptions = queryOptions({
  queryKey: ["playbooks"] as const,
  queryFn: () => listPlaybooks(),
});

export const playbookAttachmentsQueryOptions = (playbookId: string) =>
  queryOptions({
    queryKey: ["playbook-attachments", playbookId] as const,
    queryFn: () => listPlaybookAttachments({ data: { playbookId } }),
  });

export const tradeIdeasQueryOptions = (portfolioId: string | undefined) =>
  queryOptions({
    queryKey: ["trade-ideas", portfolioId] as const,
    queryFn: portfolioId ? () => listTradeIdeas({ data: { portfolioId } }) : skipToken,
  });

// ── Attachments ────────────────────────────────────────────────────────────

export const attachmentsQueryOptions = (tradeId: string) =>
  queryOptions({
    queryKey: ["attachments", tradeId] as const,
    queryFn: () => listAttachments({ data: { tradeId } }),
  });

/** Screenshots (signed URLs) for just the trades passed in — the gallery view. */
export const attachmentsForTradesQueryOptions = (tradeIds: string[]) =>
  queryOptions({
    queryKey: ["attachments-for-trades", tradeIds] as const,
    queryFn: tradeIds.length > 0 ? () => listAttachmentsForTrades({ data: { tradeIds } }) : skipToken,
  });

// ── Reviews ────────────────────────────────────────────────────────────────

export const tradeReviewQueryOptions = (tradeId: string) =>
  queryOptions({
    queryKey: ["trade-review", tradeId] as const,
    queryFn: () => getTradeReview({ data: { tradeId } }),
  });

export const tradeReviewsQueryOptions = (portfolioId: string | undefined, enabled = true) =>
  queryOptions({
    queryKey: ["trade-reviews-all", portfolioId] as const,
    queryFn: portfolioId && enabled ? () => listTradeReviews({ data: { portfolioId } }) : skipToken,
  });

export const tradesNeedingReviewQueryOptions = (
  portfolioId: string | undefined,
  accountId: string | undefined,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: ["trades-needing-review", portfolioId, accountId] as const,
    queryFn:
      portfolioId && enabled ? () => listTradesNeedingReview({ data: { portfolioId, accountId } }) : skipToken,
  });

type PeriodType = Parameters<typeof listPeriodReviews>[0]["data"]["periodType"];

export const periodReviewsQueryOptions = (
  portfolioId: string | undefined,
  periodType: PeriodType,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: ["period-reviews", portfolioId, periodType] as const,
    queryFn:
      portfolioId && enabled ? () => listPeriodReviews({ data: { portfolioId, periodType } }) : skipToken,
  });

// ── Prop firm, coach shares ────────────────────────────────────────────────

export const propFirmOverviewQueryOptions = (accountId: string | undefined) =>
  queryOptions({
    queryKey: ["prop-firm-overview", accountId] as const,
    queryFn: accountId ? () => getComplianceOverview({ data: { accountId } }) : skipToken,
  });

export const coachSharesQueryOptions = (portfolioId: string | undefined) =>
  queryOptions({
    queryKey: ["coach-shares", portfolioId] as const,
    queryFn: portfolioId ? () => listCoachShares({ data: { portfolioId } }) : skipToken,
  });

export const coachCommentsQueryOptions = (shareId: string, enabled: boolean) =>
  queryOptions({
    queryKey: ["coach-comments", shareId] as const,
    queryFn: enabled ? () => listCoachCommentsForOwner({ data: { shareId } }) : skipToken,
  });

export const sharedReportQueryOptions = (token: string) =>
  queryOptions({
    queryKey: ["shared-report", token] as const,
    queryFn: () => getSharedReport({ data: { token } }),
  });

// ── Invalidation scopes ────────────────────────────────────────────────────
// Prefix keys for `invalidateQueries`. Every factory above starts its key with
// the same leading segment(s) as these, so invalidating "all trade lists for
// this portfolio" is `invalidateQueries({ queryKey: queryKeys.trades(id) })`
// rather than a hand-typed array that can silently drift from the query it
// is meant to refresh.
export const queryKeys = {
  workspace: workspaceQueryOptions.queryKey,
  trades: (portfolioId?: string) => (portfolioId ? (["trades", portfolioId] as const) : (["trades"] as const)),
  tradeTagLinks: () => ["trade-tag-links"] as const,
  attachments: () => ["attachments"] as const,
  tradeReviews: () => ["trade-reviews-all"] as const,
  tradesNeedingReview: (portfolioId?: string) =>
    portfolioId ? (["trades-needing-review", portfolioId] as const) : (["trades-needing-review"] as const),
  tags: tagsQueryOptions.queryKey,
  playbooks: playbooksQueryOptions.queryKey,
};
