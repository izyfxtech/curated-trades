// Server functions for trade screenshot attachments. The upload itself
// happens client-side straight to Supabase Storage (RLS-scoped, same trust
// model as Postgres RLS elsewhere in this app) — these functions persist the
// resulting metadata row and mint short-lived signed URLs for display, since
// the bucket is private.
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type AttachmentRow = Database["public"]["Tables"]["trade_attachments"]["Row"];
export interface AttachmentWithUrl extends AttachmentRow {
  signedUrl: string | null;
}

const BUCKET = "trade-screenshots";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

async function assertOwnsTrade(supabase: SupabaseClient<Database>, userId: string, tradeId: string) {
  const { data, error } = await supabase
    .from("trades")
    .select("id")
    .eq("id", tradeId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Trade not found");
}

async function withSignedUrls(
  supabase: SupabaseClient<Database>,
  rows: AttachmentRow[],
): Promise<AttachmentWithUrl[]> {
  if (rows.length === 0) return [];
  const paths = rows.map((row) => row.storage_path);
  const { data: signed, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(error.message);

  const urlByPath = new Map((signed ?? []).map((entry) => [entry.path, entry.signedUrl]));
  return rows.map((row) => ({ ...row, signedUrl: urlByPath.get(row.storage_path) ?? null }));
}

/** Lightweight trade_id list (no signed URLs) for computing per-row attachment counts on the dashboard. */
/** Scoped the same way as listTradeTagLinks (see its comment) — trade_attachments has no portfolio_id column either. */
export const listAttachmentTradeIds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ portfolioId: z.string().uuid().optional() }))
  .handler(async ({ context, data }): Promise<{ trade_id: string }[]> => {
    const { supabase, userId } = context;
    let query = supabase.from("trade_attachments").select("trade_id, trades!inner(portfolio_id)").eq("owner_id", userId);
    if (data.portfolioId) {
      query = query.eq("trades.portfolio_id", data.portfolioId);
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((row) => ({ trade_id: row.trade_id }));
  });

/** All attachments (with signed URLs) for a portfolio at once — used by the Journal's screenshot gallery view, one query instead of one per trade. */
export const listAttachmentsForPortfolio = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ portfolioId: z.string().uuid() }))
  .handler(async ({ context, data }): Promise<AttachmentWithUrl[]> => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("trade_attachments")
      .select("*, trades!inner(portfolio_id)")
      .eq("owner_id", userId)
      .eq("trades.portfolio_id", data.portfolioId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const plain = (rows ?? []).map(({ trades: _trades, ...row }) => row as AttachmentRow);
    return withSignedUrls(supabase, plain);
  });

export const listAttachments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ tradeId: z.string().uuid() }))
  .handler(async ({ context, data }): Promise<AttachmentWithUrl[]> => {
    const { supabase, userId } = context;
    await assertOwnsTrade(supabase, userId, data.tradeId);

    const { data: rows, error } = await supabase
      .from("trade_attachments")
      .select("*")
      .eq("trade_id", data.tradeId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    return withSignedUrls(supabase, rows ?? []);
  });

const createAttachmentSchema = z.object({
  tradeId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
  contentType: z.string().max(100).nullable().optional(),
  fileName: z.string().max(200).nullable().optional(),
  caption: z.string().trim().max(300).nullable().optional(),
});

export const createAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(createAttachmentSchema)
  .handler(async ({ context, data }): Promise<AttachmentWithUrl> => {
    const { supabase, userId } = context;
    await assertOwnsTrade(supabase, userId, data.tradeId);

    // The upload path must live under the caller's own folder — matches the
    // storage.objects RLS policy, checked again here so a bad path fails
    // loudly with a clear message instead of a cryptic storage 403 later.
    if (!data.storagePath.startsWith(`${userId}/`)) {
      throw new Error("Attachment path must be under the caller's own storage folder.");
    }

    const { data: created, error } = await supabase
      .from("trade_attachments")
      .insert({
        trade_id: data.tradeId,
        owner_id: userId,
        storage_path: data.storagePath,
        content_type: data.contentType ?? null,
        file_name: data.fileName ?? null,
        caption: data.caption ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    const [withUrl] = await withSignedUrls(supabase, [created]);
    return withUrl ?? { ...created, signedUrl: null };
  });

const deleteAttachmentSchema = z.object({ attachmentId: z.string().uuid() });

export const deleteAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(deleteAttachmentSchema)
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;

    const { data: existing, error: existingError } = await supabase
      .from("trade_attachments")
      .select("storage_path")
      .eq("id", data.attachmentId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (!existing) throw new Error("Attachment not found");

    const { error: storageError } = await supabase.storage.from(BUCKET).remove([existing.storage_path]);
    if (storageError) throw new Error(storageError.message);

    const { error: deleteError } = await supabase
      .from("trade_attachments")
      .delete()
      .eq("id", data.attachmentId)
      .eq("owner_id", userId);
    if (deleteError) throw new Error(deleteError.message);

    return { ok: true };
  });
