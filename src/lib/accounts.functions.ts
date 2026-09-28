// Server functions for accounts — the real trading unit within a portfolio
// (see the accounts migration for the full reasoning). A portfolio's
// account list, and which one is "active" (or none, meaning "All accounts"
// aggregate scope), is bootstrapped as part of getWorkspace() in
// portfolios.functions.ts; this file covers everything that changes that
// state — create, rename/update, switch, archive.
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { friendlyNotFoundError } from "@/lib/db-errors";
import type { Database } from "@/integrations/supabase/types";

type AccountRow = Database["public"]["Tables"]["accounts"]["Row"];

export async function assertOwnsAccount(supabase: SupabaseClient<Database>, userId: string, accountId: string) {
  const { data: owned, error } = await supabase.from("accounts").select("id").eq("id", accountId).eq("owner_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!owned) throw new Error("Account not found");
}

const createAccountSchema = z.object({
  portfolioId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  accountType: z.enum(["personal", "prop"]).default("personal"),
  baseCurrency: z.string().length(3).default("USD"),
  broker: z.string().trim().max(80).nullable().optional(),
  startingEquity: z.number().positive(),
});

export const createAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(createAccountSchema)
  .handler(async ({ context, data }): Promise<AccountRow> => {
    const { supabase, userId } = context;

    // A brand-new account becomes active only if the portfolio doesn't
    // already have one active — otherwise creating a second account would
    // silently steal focus from whichever one the caller was looking at.
    const { data: existingActive, error: existingActiveError } = await supabase
      .from("accounts")
      .select("id")
      .eq("owner_id", userId)
      .eq("portfolio_id", data.portfolioId)
      .eq("is_active", true)
      .maybeSingle();
    if (existingActiveError) throw new Error(existingActiveError.message);

    const { data: created, error } = await supabase
      .from("accounts")
      .insert({
        owner_id: userId,
        portfolio_id: data.portfolioId,
        name: data.name,
        account_type: data.accountType,
        base_currency: data.baseCurrency,
        broker: data.broker ?? null,
        starting_equity: data.startingEquity,
        is_active: !existingActive,
      })
      .select("*")
      .single();
    if (error) throw friendlyNotFoundError(error, "Portfolio not found");
    return created;
  });

const updateAccountSchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  accountType: z.enum(["personal", "prop"]).optional(),
  baseCurrency: z.string().length(3).optional(),
  broker: z.string().trim().max(80).nullable().optional(),
  defaultRiskPercent: z.number().positive().max(100).optional(),
  // Only meaningful before this account has any trades — see the
  // has-trades check below. Bumps starting equity only; unlike a portfolio
  // there's no separate "current_equity" column to keep in step with it.
  startingEquity: z.number().positive().optional(),
});

export const updateAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(updateAccountSchema)
  .handler(async ({ context, data }): Promise<AccountRow> => {
    const { supabase, userId } = context;

    if (data.startingEquity !== undefined) {
      const { data: anyTrade, error: tradeCheckError } = await supabase
        .from("trades")
        .select("id")
        .eq("owner_id", userId)
        .eq("account_id", data.accountId)
        .limit(1)
        .maybeSingle();
      if (tradeCheckError) throw new Error(tradeCheckError.message);
      if (anyTrade) throw new Error("Starting equity can't be changed once an account has logged trades.");
    }

    const payload: Database["public"]["Tables"]["accounts"]["Update"] = {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.accountType !== undefined ? { account_type: data.accountType } : {}),
      ...(data.baseCurrency !== undefined ? { base_currency: data.baseCurrency } : {}),
      ...(data.broker !== undefined ? { broker: data.broker } : {}),
      ...(data.defaultRiskPercent !== undefined ? { default_risk_percent: data.defaultRiskPercent } : {}),
      ...(data.startingEquity !== undefined ? { starting_equity: data.startingEquity } : {}),
    };

    const { data: updated, error } = await supabase
      .from("accounts")
      .update(payload)
      .eq("id", data.accountId)
      .eq("owner_id", userId)
      .select("*")
      .single();
    if (error) throw friendlyNotFoundError(error, "Account not found");
    return updated;
  });

const setActiveAccountSchema = z.object({
  portfolioId: z.string().uuid(),
  // null (or omitted) means "All accounts" — the portfolio-wide aggregate
  // scope — which is why this isn't just "clear the old one, activate the
  // new one" like setActivePortfolio: there may be nothing to activate.
  accountId: z.string().uuid().nullable(),
});

export const setActiveAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(setActiveAccountSchema)
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;

    const { error: clearError } = await supabase
      .from("accounts")
      .update({ is_active: false })
      .eq("owner_id", userId)
      .eq("portfolio_id", data.portfolioId);
    if (clearError) throw new Error(clearError.message);

    if (data.accountId) {
      const { error: activateError } = await supabase
        .from("accounts")
        .update({ is_active: true })
        .eq("id", data.accountId)
        .eq("owner_id", userId)
        .eq("portfolio_id", data.portfolioId);
      if (activateError) throw friendlyNotFoundError(activateError, "Account not found");
    }
    return { ok: true };
  });

const archiveAccountSchema = z.object({ accountId: z.string().uuid() });

/** Archives an account (hides it from switchers/pickers) rather than deleting it — its trades and compliance history stay intact and reachable. */
export const archiveAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(archiveAccountSchema)
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;

    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("portfolio_id, is_active")
      .eq("id", data.accountId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (accountError) throw new Error(accountError.message);
    if (!account) throw new Error("Account not found");

    const { error: archiveError } = await supabase
      .from("accounts")
      .update({ is_archived: true, is_active: false })
      .eq("id", data.accountId)
      .eq("owner_id", userId);
    if (archiveError) throw new Error(archiveError.message);

    // Archiving the active account leaves the portfolio with no active
    // account at all (falls back to "All accounts") unless another one is
    // available to take over — picking the first remaining one keeps the
    // switcher from just going blank.
    if (account.is_active) {
      const { data: fallback, error: fallbackError } = await supabase
        .from("accounts")
        .select("id")
        .eq("owner_id", userId)
        .eq("portfolio_id", account.portfolio_id)
        .eq("is_archived", false)
        .order("name")
        .limit(1)
        .maybeSingle();
      if (fallbackError) throw new Error(fallbackError.message);
      if (fallback) {
        const { error: reactivateError } = await supabase.from("accounts").update({ is_active: true }).eq("id", fallback.id);
        if (reactivateError) throw new Error(reactivateError.message);
      }
    }

    return { ok: true };
  });
