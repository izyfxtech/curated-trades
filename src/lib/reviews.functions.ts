// Server functions for post-trade review (Phase 2.2). Mistake/behavior tags
// reuse the existing tags system (category = "mistake") via a category-scoped
// sync so saving a review never touches a trade's other (e.g. setup) tags.
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { friendlyNotFoundError } from "@/lib/db-errors";
import { fetchAllRows } from "@/lib/paging";
import type { Database } from "@/integrations/supabase/types";

type TradeReviewRow = Database["public"]["Tables"]["trade_reviews"]["Row"];
type TradeRow = Database["public"]["Tables"]["trades"]["Row"];
type PeriodReviewRow = Database["public"]["Tables"]["period_reviews"]["Row"];

const listNeedingReviewSchema = z.object({
  portfolioId: z.string().uuid(),
  // Omitted means "All accounts" — same convention as listTrades.
  accountId: z.string().uuid().optional(),
});

/** Closed trades in a portfolio that don't have a review yet — the review queue.
 *
 * "No review" is expressed as an anti-join (`trade_reviews is null` on the
 * embedded relation), so the database does the work. This replaced fetching
 * the id of every reviewed trade and sending them all back in a
 * `NOT IN (id, id, …)` URL — which breaks once a few hundred trades have been
 * reviewed (the request line gets too long) — and dropped a hard cap of 200
 * rows that hid the rest of the queue. */
export const listTradesNeedingReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(listNeedingReviewSchema)
  .handler(async ({ context, data }): Promise<TradeRow[]> => {
    // Read-only: RLS + the owner_id filters below already make a foreign
    // portfolioId return an empty list rather than leaking anything, so no
    // separate ownership round trip is needed here.
    const { supabase, userId } = context;

    const rows = await fetchAllRows((from, to) => {
      let query = supabase
        .from("trades")
        .select("*, trade_reviews(id)")
        .eq("owner_id", userId)
        .eq("portfolio_id", data.portfolioId)
        .eq("status", "closed")
        .is("trade_reviews", null);
      if (data.accountId) query = query.eq("account_id", data.accountId);
      return query.order("closed_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
    });
    return rows.map(({ trade_reviews: _none, ...trade }) => trade as TradeRow);
  });

/** The user's trade reviews, scoped to a portfolio the same way as
 * listTradeTagLinks (trade_reviews has no portfolio_id column either) — the
 * client joins these against already-fetched, portfolio-scoped trades.
 */
export const listTradeReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ portfolioId: z.string().uuid().optional() }))
  .handler(async ({ context, data }): Promise<TradeReviewRow[]> => {
    const { supabase, userId } = context;
    const rows = await fetchAllRows((from, to) => {
      let query = supabase.from("trade_reviews").select("*, trades!inner(portfolio_id)").eq("owner_id", userId);
      if (data.portfolioId) {
        query = query.eq("trades.portfolio_id", data.portfolioId);
      }
      return query.order("trade_id").range(from, to);
    });
    return rows.map(({ trades: _trades, ...row }) => row as TradeReviewRow);
  });

const getTradeReviewSchema = z.object({ tradeId: z.string().uuid() });

export interface TradeReviewWithMistakeTags extends TradeReviewRow {
  mistakeTagIds: string[];
}

/** A single trade's review plus its mistake-tag ids, for the review modal. */
export const getTradeReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(getTradeReviewSchema)
  .handler(async ({ context, data }): Promise<TradeReviewWithMistakeTags | null> => {
    const { supabase, userId } = context;

    const { data: review, error } = await supabase
      .from("trade_reviews")
      .select("*")
      .eq("owner_id", userId)
      .eq("trade_id", data.tradeId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!review) return null;

    const { data: mistakeTags, error: mistakeTagsError } = await supabase
      .from("tags")
      .select("id")
      .eq("owner_id", userId)
      .eq("category", "mistake");
    if (mistakeTagsError) throw new Error(mistakeTagsError.message);
    const mistakeTagIds = new Set((mistakeTags ?? []).map((t) => t.id));

    const { data: links, error: linksError } = await supabase
      .from("trade_tags")
      .select("tag_id")
      .eq("owner_id", userId)
      .eq("trade_id", data.tradeId);
    if (linksError) throw new Error(linksError.message);

    return { ...review, mistakeTagIds: (links ?? []).map((l) => l.tag_id).filter((id) => mistakeTagIds.has(id)) };
  });

async function syncMistakeTags(supabase: SupabaseClient<Database>, userId: string, tradeId: string, tagIds: string[]) {
  const { data: mistakeTags, error: mistakeTagsError } = await supabase
    .from("tags")
    .select("id")
    .eq("owner_id", userId)
    .eq("category", "mistake");
  if (mistakeTagsError) throw new Error(mistakeTagsError.message);
  const mistakeTagIds = (mistakeTags ?? []).map((t) => t.id);

  if (mistakeTagIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("trade_tags")
      .delete()
      .eq("trade_id", tradeId)
      .eq("owner_id", userId)
      .in("tag_id", mistakeTagIds);
    if (deleteError) throw new Error(deleteError.message);
  }
  if (tagIds.length === 0) return;

  const { error: insertError } = await supabase
    .from("trade_tags")
    .insert(tagIds.map((tagId) => ({ trade_id: tradeId, tag_id: tagId, owner_id: userId })));
  if (insertError) throw new Error(insertError.message);
}

const saveTradeReviewSchema = z.object({
  tradeId: z.string().uuid(),
  mode: z.enum(["quick", "full"]),
  planAdherence: z.enum(["followed", "partial", "deviated"]).nullable().optional(),
  disciplineScore: z.number().int().min(1).max(5).nullable().optional(),
  emotionalStateBefore: z.string().trim().max(40).nullable().optional(),
  emotionalStateDuring: z.string().trim().max(40).nullable().optional(),
  emotionalStateAfter: z.string().trim().max(40).nullable().optional(),
  bestDecision: z.string().trim().max(1000).nullable().optional(),
  worstDecision: z.string().trim().max(1000).nullable().optional(),
  lessonLearned: z.string().trim().max(1000).nullable().optional(),
  mistakeTagIds: z.array(z.string().uuid()).max(20).default([]),
});

export const saveTradeReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(saveTradeReviewSchema)
  .handler(async ({ context, data }): Promise<TradeReviewRow> => {
    const { supabase, userId } = context;

    const { data: trade, error: tradeError } = await supabase
      .from("trades")
      .select("id")
      .eq("id", data.tradeId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (tradeError) throw new Error(tradeError.message);
    if (!trade) throw new Error("Trade not found");

    const { data: saved, error } = await supabase
      .from("trade_reviews")
      .upsert(
        {
          owner_id: userId,
          trade_id: data.tradeId,
          mode: data.mode,
          plan_adherence: data.planAdherence ?? null,
          discipline_score: data.disciplineScore ?? null,
          emotional_state_before: data.emotionalStateBefore ?? null,
          emotional_state_during: data.emotionalStateDuring ?? null,
          emotional_state_after: data.emotionalStateAfter ?? null,
          best_decision: data.bestDecision ?? null,
          worst_decision: data.worstDecision ?? null,
          lesson_learned: data.lessonLearned ?? null,
        },
        { onConflict: "trade_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await syncMistakeTags(supabase, userId, data.tradeId, data.mistakeTagIds);
    return saved;
  });

const listPeriodReviewsSchema = z.object({
  portfolioId: z.string().uuid(),
  periodType: z.enum(["weekly", "monthly"]),
});

export const listPeriodReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(listPeriodReviewsSchema)
  .handler(async ({ context, data }): Promise<PeriodReviewRow[]> => {
    // Read-only, same reasoning as listTradesNeedingReview above.
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("period_reviews")
      .select("*")
      .eq("owner_id", userId)
      .eq("portfolio_id", data.portfolioId)
      .eq("period_type", data.periodType)
      .order("period_start", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const savePeriodReviewSchema = z.object({
  portfolioId: z.string().uuid(),
  periodType: z.enum(["weekly", "monthly"]),
  periodStart: z.string(),
  periodEnd: z.string(),
  commitment: z.string().trim().max(1000).nullable().optional(),
});

export const savePeriodReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(savePeriodReviewSchema)
  .handler(async ({ context, data }): Promise<PeriodReviewRow> => {
    const { supabase, userId } = context;

    // No pre-check: period_reviews' RLS WITH CHECK already rejects this
    // upsert (42501) if portfolioId isn't the caller's.
    const { data: saved, error } = await supabase
      .from("period_reviews")
      .upsert(
        {
          owner_id: userId,
          portfolio_id: data.portfolioId,
          period_type: data.periodType,
          period_start: data.periodStart,
          period_end: data.periodEnd,
          commitment: data.commitment ?? null,
        },
        { onConflict: "owner_id,portfolio_id,period_type,period_start" },
      )
      .select("*")
      .single();
    if (error) throw friendlyNotFoundError(error, "Portfolio not found");
    return saved;
  });
