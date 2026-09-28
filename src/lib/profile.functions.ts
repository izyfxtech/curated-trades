// Server functions for the trader's profile. Every export here is gated by
// requireSupabaseAuth — the middleware is the actual security boundary, not
// whatever route happens to call it (a route beforeLoad is UX, not auth).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

/** Reads the caller's profile, creating one on first sign-in. */
export const getOrCreateProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProfileRow> => {
    const { supabase, userId, claims } = context;

    const { data: existing, error: readError } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (existing) return existing;

    const fallbackName =
      typeof claims.email === "string" ? (claims.email.split("@")[0] ?? null) : null;
    const { data: created, error: createError } = await supabase
      .from("profiles")
      .insert({ user_id: userId, display_name: fallbackName })
      .select("*")
      .single();
    if (createError) throw new Error(createError.message);
    return created;
  });

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  timezone: z.string().min(1).max(64).optional(),
  baseCurrency: z.string().length(3).optional(),
  traderType: z.enum(["day", "scalp", "swing", "position"]).optional(),
  onboardingCompleted: z.boolean().optional(),
});

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(updateProfileSchema)
  .handler(async ({ context, data }): Promise<ProfileRow> => {
    const { supabase, userId } = context;

    const payload: Database["public"]["Tables"]["profiles"]["Update"] = {
      ...(data.displayName !== undefined ? { display_name: data.displayName } : {}),
      ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
      ...(data.baseCurrency !== undefined ? { base_currency: data.baseCurrency } : {}),
      ...(data.traderType !== undefined ? { trader_type: data.traderType } : {}),
      ...(data.onboardingCompleted !== undefined
        ? { onboarding_completed: data.onboardingCompleted }
        : {}),
    };

    const { data: updated, error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });
