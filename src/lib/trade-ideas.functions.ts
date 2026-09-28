// Server functions for trade ideas (Phase 2.1) — setups tracked before (and
// independent of) whether they became a logged trade.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { friendlyNotFoundError } from "@/lib/db-errors";
import type { Database } from "@/integrations/supabase/types";

type TradeIdeaRow = Database["public"]["Tables"]["trade_ideas"]["Row"];

const listTradeIdeasSchema = z.object({ portfolioId: z.string().uuid() });

export const listTradeIdeas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(listTradeIdeasSchema)
  .handler(async ({ context, data }): Promise<TradeIdeaRow[]> => {
    // Read-only: RLS + owner_id filter make a foreign portfolioId return an
    // empty list rather than needing a separate ownership round trip.
    const { supabase, userId } = context;
    const { data: ideas, error } = await supabase
      .from("trade_ideas")
      .select("*")
      .eq("owner_id", userId)
      .eq("portfolio_id", data.portfolioId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ideas ?? [];
  });

const createTradeIdeaSchema = z.object({
  portfolioId: z.string().uuid(),
  playbookId: z.string().uuid().nullable().optional(),
  symbol: z.string().trim().min(1).max(20),
  market: z.enum(["forex", "crypto"]),
  direction: z.enum(["long", "short"]),
  plannedEntry: z.number().positive().nullable().optional(),
  plannedStop: z.number().positive().nullable().optional(),
  plannedTarget: z.number().positive().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const createTradeIdea = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(createTradeIdeaSchema)
  .handler(async ({ context, data }): Promise<TradeIdeaRow> => {
    const { supabase, userId } = context;

    // No pre-check: trade_ideas' RLS WITH CHECK already rejects this insert
    // (42501) if portfolioId isn't the caller's.
    const { data: created, error } = await supabase
      .from("trade_ideas")
      .insert({
        owner_id: userId,
        portfolio_id: data.portfolioId,
        playbook_id: data.playbookId ?? null,
        symbol: data.symbol.toUpperCase(),
        market: data.market,
        direction: data.direction,
        planned_entry: data.plannedEntry ?? null,
        planned_stop: data.plannedStop ?? null,
        planned_target: data.plannedTarget ?? null,
        notes: data.notes ?? null,
      })
      .select("*")
      .single();
    if (error) throw friendlyNotFoundError(error, "Portfolio not found");
    return created;
  });

const setTradeIdeaStatusSchema = z.object({
  ideaId: z.string().uuid(),
  status: z.enum(["pending", "taken", "missed", "invalidated"]),
  takenTradeId: z.string().uuid().nullable().optional(),
});

export const setTradeIdeaStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(setTradeIdeaStatusSchema)
  .handler(async ({ context, data }): Promise<TradeIdeaRow> => {
    const { supabase, userId } = context;

    // Collapsed from select-then-update to a single filtered update: a
    // wrong/foreign ideaId now matches zero rows (PGRST116 from .single())
    // instead of needing a separate existence check first.
    const { data: updated, error } = await supabase
      .from("trade_ideas")
      .update({
        status: data.status,
        ...(data.takenTradeId !== undefined ? { taken_trade_id: data.takenTradeId } : {}),
      })
      .eq("id", data.ideaId)
      .eq("owner_id", userId)
      .select("*")
      .single();
    if (error) throw friendlyNotFoundError(error, "Trade idea not found");
    return updated;
  });

const deleteTradeIdeaSchema = z.object({ ideaId: z.string().uuid() });

export const deleteTradeIdea = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(deleteTradeIdeaSchema)
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("trade_ideas").delete().eq("id", data.ideaId).eq("owner_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
