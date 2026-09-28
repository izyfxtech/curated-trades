// Owner-side server functions for coach share links (Phase 2.5). These run
// through the normal authenticated Supabase client (RLS-scoped), same as
// every other *.functions.ts file — only the coach-facing read/comment path
// (lib/public-share.functions.ts) needs the service-role client, since that
// one has no logged-in user at all.
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { friendlyNotFoundError } from "@/lib/db-errors";
import type { Database } from "@/integrations/supabase/types";

type CoachShareRow = Database["public"]["Tables"]["coach_shares"]["Row"];
type CoachCommentRow = Database["public"]["Tables"]["coach_comments"]["Row"];

async function assertOwnsPortfolio(supabase: SupabaseClient<Database>, userId: string, portfolioId: string) {
  const { data, error } = await supabase.from("portfolios").select("id").eq("id", portfolioId).eq("owner_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Portfolio not found");
}

/** 32 hex chars from a v4 UUID's randomness (122 bits) — plenty for a share link, and URL-clean without dashes. */
function generateShareToken(): string {
  return randomUUID().replace(/-/g, "");
}

export const listCoachShares = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ portfolioId: z.string().uuid() }))
  .handler(async ({ context, data }): Promise<CoachShareRow[]> => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("coach_shares")
      .select("*")
      .eq("owner_id", userId)
      .eq("portfolio_id", data.portfolioId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const createShareSchema = z.object({
  portfolioId: z.string().uuid(),
  label: z.string().trim().min(1).max(80).default("Shared report"),
  permission: z.enum(["read", "comment"]).default("read"),
  hideDollarPnl: z.boolean().default(true),
  periodStart: z.string().nullable().optional(),
  periodEnd: z.string().nullable().optional(),
  expiresInDays: z.number().int().positive().max(365).nullable().optional(),
});

export const createCoachShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(createShareSchema)
  .handler(async ({ context, data }): Promise<CoachShareRow> => {
    const { supabase, userId } = context;
    await assertOwnsPortfolio(supabase, userId, data.portfolioId);

    const expiresAt =
      data.expiresInDays != null ? new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000).toISOString() : null;

    const { data: created, error } = await supabase
      .from("coach_shares")
      .insert({
        owner_id: userId,
        portfolio_id: data.portfolioId,
        token: generateShareToken(),
        label: data.label,
        permission: data.permission,
        hide_dollar_pnl: data.hideDollarPnl,
        period_start: data.periodStart ?? null,
        period_end: data.periodEnd ?? null,
        expires_at: expiresAt,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return created;
  });

const revokeShareSchema = z.object({ shareId: z.string().uuid() });

export const revokeCoachShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(revokeShareSchema)
  .handler(async ({ context, data }): Promise<CoachShareRow> => {
    const { supabase, userId } = context;
    const { data: updated, error } = await supabase
      .from("coach_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.shareId)
      .eq("owner_id", userId)
      .select("*")
      .single();
    if (error) throw friendlyNotFoundError(error, "Share link not found");
    return updated;
  });

const listShareCommentsSchema = z.object({ shareId: z.string().uuid() });

/** Owner-side read of comments a coach left on one of the owner's shares. */
export const listCoachCommentsForOwner = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(listShareCommentsSchema)
  .handler(async ({ context, data }): Promise<CoachCommentRow[]> => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("coach_comments")
      .select("*")
      .eq("owner_id", userId)
      .eq("share_id", data.shareId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
