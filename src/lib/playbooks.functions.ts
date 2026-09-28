// Server functions for playbooks (Phase 2.1). Checklist items are edited as
// a whole ordered list per playbook rather than one-row-at-a-time CRUD —
// that matches how a playbook editor actually works (edit the checklist,
// save it) and avoids needing a separate reorder endpoint.
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type PlaybookRow = Database["public"]["Tables"]["playbooks"]["Row"];
type ChecklistItemRow = Database["public"]["Tables"]["playbook_checklist_items"]["Row"];
type AttachmentRow = Database["public"]["Tables"]["playbook_attachments"]["Row"];
export interface AttachmentWithUrl extends AttachmentRow {
  signedUrl: string | null;
}

const BUCKET = "trade-screenshots";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

async function assertOwnsPlaybook(supabase: SupabaseClient<Database>, userId: string, playbookId: string) {
  const { data, error } = await supabase
    .from("playbooks")
    .select("id")
    .eq("id", playbookId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Playbook not found");
}

export interface PlaybookWithChecklist extends PlaybookRow {
  checklistItems: ChecklistItemRow[];
}

export const listPlaybooks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlaybookWithChecklist[]> => {
    const { supabase, userId } = context;
    const { data: playbooks, error } = await supabase
      .from("playbooks")
      .select("*")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: items, error: itemsError } = await supabase
      .from("playbook_checklist_items")
      .select("*")
      .eq("owner_id", userId)
      .order("order_index", { ascending: true });
    if (itemsError) throw new Error(itemsError.message);

    const itemsByPlaybook = new Map<string, ChecklistItemRow[]>();
    for (const item of items ?? []) {
      const list = itemsByPlaybook.get(item.playbook_id) ?? [];
      list.push(item);
      itemsByPlaybook.set(item.playbook_id, list);
    }

    return (playbooks ?? []).map((playbook) => ({
      ...playbook,
      checklistItems: itemsByPlaybook.get(playbook.id) ?? [],
    }));
  });

const checklistItemInputSchema = z.object({
  prompt: z.string().trim().min(1).max(200),
  isRequired: z.boolean().default(true),
});

const savePlaybookSchema = z.object({
  playbookId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(100),
  market: z.enum(["forex", "crypto"]),
  direction: z.enum(["long", "short", "both"]),
  description: z.string().trim().max(2000).nullable().optional(),
  idealConditions: z.string().trim().max(2000).nullable().optional(),
  invalidationRules: z.string().trim().max(2000).nullable().optional(),
  checklistItems: z.array(checklistItemInputSchema).max(30).default([]),
});

/** Creates or fully updates a playbook plus its checklist in one call. */
export const savePlaybook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(savePlaybookSchema)
  .handler(async ({ context, data }): Promise<PlaybookWithChecklist> => {
    const { supabase, userId } = context;

    const playbookPayload = {
      owner_id: userId,
      name: data.name,
      market: data.market,
      direction: data.direction,
      description: data.description ?? null,
      ideal_conditions: data.idealConditions ?? null,
      invalidation_rules: data.invalidationRules ?? null,
    };

    let playbook: PlaybookRow;
    if (data.playbookId) {
      await assertOwnsPlaybook(supabase, userId, data.playbookId);
      const { data: updated, error } = await supabase
        .from("playbooks")
        .update(playbookPayload)
        .eq("id", data.playbookId)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      playbook = updated;

      const { error: deleteError } = await supabase
        .from("playbook_checklist_items")
        .delete()
        .eq("playbook_id", playbook.id);
      if (deleteError) throw new Error(deleteError.message);
    } else {
      const { data: created, error } = await supabase
        .from("playbooks")
        .insert(playbookPayload)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      playbook = created;
    }

    let checklistItems: ChecklistItemRow[] = [];
    if (data.checklistItems.length > 0) {
      const { data: insertedItems, error: itemsError } = await supabase
        .from("playbook_checklist_items")
        .insert(
          data.checklistItems.map((item, index) => ({
            playbook_id: playbook.id,
            owner_id: userId,
            order_index: index,
            prompt: item.prompt,
            is_required: item.isRequired,
          })),
        )
        .select("*");
      if (itemsError) throw new Error(itemsError.message);
      checklistItems = insertedItems ?? [];
    }

    return { ...playbook, checklistItems };
  });

const setPlaybookStatusSchema = z.object({
  playbookId: z.string().uuid(),
  status: z.enum(["active", "archived"]),
});

export const setPlaybookStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(setPlaybookStatusSchema)
  .handler(async ({ context, data }): Promise<PlaybookRow> => {
    const { supabase, userId } = context;
    await assertOwnsPlaybook(supabase, userId, data.playbookId);
    const { data: updated, error } = await supabase
      .from("playbooks")
      .update({ status: data.status })
      .eq("id", data.playbookId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

const deletePlaybookSchema = z.object({ playbookId: z.string().uuid() });

export const deletePlaybook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(deletePlaybookSchema)
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    await assertOwnsPlaybook(supabase, userId, data.playbookId);
    const { error } = await supabase.from("playbooks").delete().eq("id", data.playbookId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function withSignedUrls(
  supabase: SupabaseClient<Database>,
  rows: AttachmentRow[],
): Promise<AttachmentWithUrl[]> {
  if (rows.length === 0) return [];
  const paths = rows.map((row) => row.storage_path);
  const { data: signed, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(error.message);
  const urlByPath = new Map((signed ?? []).map((entry) => [entry.path, entry.signedUrl]));
  return rows.map((row) => ({ ...row, signedUrl: urlByPath.get(row.storage_path) ?? null }));
}

export const listPlaybookAttachments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ playbookId: z.string().uuid() }))
  .handler(async ({ context, data }): Promise<AttachmentWithUrl[]> => {
    const { supabase, userId } = context;
    await assertOwnsPlaybook(supabase, userId, data.playbookId);
    const { data: rows, error } = await supabase
      .from("playbook_attachments")
      .select("*")
      .eq("playbook_id", data.playbookId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return withSignedUrls(supabase, rows ?? []);
  });

const createPlaybookAttachmentSchema = z.object({
  playbookId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
  contentType: z.string().max(100).nullable().optional(),
  fileName: z.string().max(200).nullable().optional(),
  caption: z.string().trim().max(300).nullable().optional(),
});

export const createPlaybookAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(createPlaybookAttachmentSchema)
  .handler(async ({ context, data }): Promise<AttachmentWithUrl> => {
    const { supabase, userId } = context;
    await assertOwnsPlaybook(supabase, userId, data.playbookId);

    if (!data.storagePath.startsWith(`${userId}/playbooks/`)) {
      throw new Error("Attachment path must be under the caller's own playbooks storage folder.");
    }

    const { data: created, error } = await supabase
      .from("playbook_attachments")
      .insert({
        playbook_id: data.playbookId,
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

const deletePlaybookAttachmentSchema = z.object({ attachmentId: z.string().uuid() });

export const deletePlaybookAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(deletePlaybookAttachmentSchema)
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;

    const { data: existing, error: existingError } = await supabase
      .from("playbook_attachments")
      .select("storage_path")
      .eq("id", data.attachmentId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (!existing) throw new Error("Attachment not found");

    const { error: storageError } = await supabase.storage.from(BUCKET).remove([existing.storage_path]);
    if (storageError) throw new Error(storageError.message);

    const { error: deleteError } = await supabase
      .from("playbook_attachments")
      .delete()
      .eq("id", data.attachmentId)
      .eq("owner_id", userId);
    if (deleteError) throw new Error(deleteError.message);

    return { ok: true };
  });
