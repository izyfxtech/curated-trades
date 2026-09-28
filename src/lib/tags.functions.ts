// Server functions for tags (setups, mistakes, emotions, etc.) attached to
// trades via trade_tags. See trades.functions.ts for how a trade's tag set
// is synced on create/update.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type TagRow = Database["public"]["Tables"]["tags"]["Row"];

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

export const listTags = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TagRow[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("tags")
      .select("*")
      .eq("owner_id", userId)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const createTagSchema = z.object({
  name: z.string().trim().min(1).max(40),
  category: z.enum(["setup", "mistake", "emotion", "general"]).default("general"),
});

export const createTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(createTagSchema)
  .handler(async ({ context, data }): Promise<TagRow> => {
    const { supabase, userId } = context;
    const slug = slugify(data.name);
    if (!slug) throw new Error("Tag name must contain at least one letter or number.");

    // Upsert on (owner_id, slug) so re-adding an existing tag name just returns it.
    const { data: created, error } = await supabase
      .from("tags")
      .upsert(
        { owner_id: userId, name: data.name.trim(), slug, category: data.category },
        { onConflict: "owner_id,slug" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return created;
  });

const deleteTagSchema = z.object({ tagId: z.string().uuid() });

export const deleteTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(deleteTagSchema)
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("tags").delete().eq("id", data.tagId).eq("owner_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
