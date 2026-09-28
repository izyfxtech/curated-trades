// Server functions for portfolios and portfolio settings. Multi-portfolio is
// supported from the start even though the journal UI opens on one selected
// (active) portfolio at a time. Within a portfolio, accounts (see
// accounts.functions.ts) are the real trading unit — a portfolio itself is
// just an organizational folder now (name only; no equity, no risk %, no
// compliance — those all live on the account).
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import Decimal from "decimal.js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { friendlyNotFoundError } from "@/lib/db-errors";
import type { Database } from "@/integrations/supabase/types";

type PortfolioRow = Database["public"]["Tables"]["portfolios"]["Row"];
type PortfolioSettingsRow = Database["public"]["Tables"]["portfolio_settings"]["Row"];
type AccountRow = Database["public"]["Tables"]["accounts"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

const DEFAULT_STARTING_EQUITY = 50000;

export interface WorkspaceData {
  profile: ProfileRow;
  portfolios: PortfolioRow[];
  activePortfolio: PortfolioRow;
  settings: PortfolioSettingsRow;
  /** Every non-archived account in the active portfolio. */
  accounts: AccountRow[];
  /**
   * The one account currently in focus, or null for "All accounts" — the
   * portfolio-wide aggregate scope. null is a real, first-class state here
   * (not "not loaded yet"): it means every page should show summed figures
   * across every account in accounts[] rather than one account's own.
   */
  activeAccount: AccountRow | null;
  /**
   * Starting equity + the sum of net_pnl across closed trades, computed
   * fresh on every workspace load — scoped to activeAccount if one is set,
   * or summed across every account in the portfolio if scope is "All
   * accounts". This is the number anything doing real position-sizing math
   * (the risk preview in LogTradeModal, the standalone risk calculator)
   * should read.
   *
   * Per-account starting_equity/default_risk_percent superseded
   * portfolios.starting_equity and portfolio_settings.default_risk_percent
   * when accounts were introduced — those two columns are left in place
   * (dropping is irreversible) but nothing reads them for live math anymore.
   */
  liveEquity: number;
  /**
   * The same scope's starting point (before any closed-trade P&L) —
   * activeAccount.starting_equity, or the sum across every account in
   * accounts[] for "All accounts". Analytics and the dashboard use this as
   * the baseline for their own equity-curve/stat math instead of the
   * deprecated portfolios.starting_equity column.
   */
  startingEquity: number;
}

async function ensureDefaultAccount(
  supabase: SupabaseClient<Database>,
  userId: string,
  portfolioId: string,
  startingEquity: number,
): Promise<AccountRow> {
  const { data: created, error } = await supabase
    .from("accounts")
    .insert({
      owner_id: userId,
      portfolio_id: portfolioId,
      name: "Main",
      starting_equity: startingEquity,
      is_active: true,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return created;
}

/**
 * One-call bootstrap for the journal: profile, the full portfolio list, the
 * active portfolio, its accounts and active account, and that portfolio's
 * settings — creating defaults on first sign-in. Replaces the separate
 * client-side Supabase calls the old dashboard made directly from the
 * browser.
 */
export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WorkspaceData> => {
    const { supabase, userId, claims } = context;

    // The profile lookup and the portfolios lookup don't depend on each
    // other, so run them concurrently instead of one after the other — cuts
    // this bootstrap call's happy-path round trips from 3 down to 2.
    const [profileLookup, portfoliosLookup] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("portfolios").select("*").eq("owner_id", userId).order("created_at", { ascending: true }),
    ]);
    if (profileLookup.error) throw new Error(profileLookup.error.message);
    if (portfoliosLookup.error) throw new Error(portfoliosLookup.error.message);
    let profile = profileLookup.data;

    if (!profile) {
      const fallbackName =
        typeof claims.email === "string" ? (claims.email.split("@")[0] ?? null) : null;
      const { data: createdProfile, error: createProfileError } = await supabase
        .from("profiles")
        .insert({ user_id: userId, display_name: fallbackName })
        .select("*")
        .single();
      if (createProfileError) {
        // 23505 = unique_violation. profiles.user_id is UNIQUE, so this means
        // another concurrent request for this same brand-new user (e.g. a
        // second tab, or a double-fired mount right after signup) already
        // created the row a moment ago — read it instead of failing outright.
        if (createProfileError.code === "23505") {
          const retryLookup = await supabase.from("profiles").select("*").eq("user_id", userId).single();
          if (retryLookup.error) throw new Error(retryLookup.error.message);
          profile = retryLookup.data;
        } else {
          throw new Error(createProfileError.message);
        }
      } else {
        profile = createdProfile;
      }
    }

    const portfolioList = portfoliosLookup.data ?? [];
    let activePortfolio = portfolioList.find((item) => item.is_active) ?? portfolioList[0];

    if (!activePortfolio) {
      const { data: createdPortfolio, error: createPortfolioError } = await supabase
        .from("portfolios")
        .insert({
          owner_id: userId,
          name: "Personal",
          starting_equity: DEFAULT_STARTING_EQUITY,
          current_equity: DEFAULT_STARTING_EQUITY,
          is_active: true,
        })
        .select("*")
        .single();
      if (createPortfolioError) throw new Error(createPortfolioError.message);
      activePortfolio = createdPortfolio;
      portfolioList.push(createdPortfolio);

      const { error: createSettingsError } = await supabase
        .from("portfolio_settings")
        .insert({ portfolio_id: createdPortfolio.id });
      if (createSettingsError) throw new Error(createSettingsError.message);
    }

    // Settings and accounts don't depend on each other, so run them
    // concurrently rather than one after the other.
    const [settingsLookup, accountsLookup] = await Promise.all([
      supabase.from("portfolio_settings").select("*").eq("portfolio_id", activePortfolio.id).maybeSingle(),
      supabase
        .from("accounts")
        .select("*")
        .eq("owner_id", userId)
        .eq("portfolio_id", activePortfolio.id)
        .eq("is_archived", false)
        .order("name"),
    ]);
    if (settingsLookup.error) throw new Error(settingsLookup.error.message);
    if (accountsLookup.error) throw new Error(accountsLookup.error.message);
    let settings = settingsLookup.data;

    if (!settings) {
      const { data: createdSettings, error: createSettingsError } = await supabase
        .from("portfolio_settings")
        .insert({ portfolio_id: activePortfolio.id })
        .select("*")
        .single();
      if (createSettingsError) throw new Error(createSettingsError.message);
      settings = createdSettings;
    }

    let accounts = accountsLookup.data ?? [];
    if (accounts.length === 0) {
      // Every portfolio the accounts migration touched already has one —
      // this only fires for a portfolio created in the moment just above,
      // or in the small window where accounts.functions.ts hasn't run yet.
      const defaultAccount = await ensureDefaultAccount(supabase, userId, activePortfolio.id, activePortfolio.starting_equity);
      accounts = [defaultAccount];
    }
    const activeAccount = accounts.find((account) => account.is_active) ?? null;

    // "All accounts" (activeAccount === null) sums net_pnl across every
    // account in the portfolio via trades.portfolio_id — kept as a real,
    // indexed column specifically so this doesn't need to join or loop
    // per-account (see the accounts migration's comment on why that column
    // is safe to keep). A single active account instead scopes by its own
    // account_id and starting_equity only.
    const pnlQuery = activeAccount
      ? supabase.from("trades").select("net_pnl").eq("owner_id", userId).eq("account_id", activeAccount.id).eq("status", "closed")
      : supabase.from("trades").select("net_pnl").eq("owner_id", userId).eq("portfolio_id", activePortfolio.id).eq("status", "closed");
    const { data: closedPnlRows, error: pnlError } = await pnlQuery;
    if (pnlError) throw new Error(pnlError.message);

    const baseEquity = activeAccount
      ? activeAccount.starting_equity
      : accounts.reduce((sum, account) => sum + account.starting_equity, 0);
    const liveEquity = (closedPnlRows ?? [])
      .reduce((sum, row) => sum.plus(row.net_pnl ?? 0), new Decimal(baseEquity))
      .toNumber();

    return { profile, portfolios: portfolioList, activePortfolio, settings, accounts, activeAccount, liveEquity, startingEquity: baseEquity };
  });

const createPortfolioSchema = z.object({
  name: z.string().trim().min(1).max(80),
  accountType: z.enum(["personal", "prop"]),
  baseCurrency: z.string().length(3).default("USD"),
  startingEquity: z.number().positive(),
});

/** Creates a portfolio AND its first account together — a portfolio with zero accounts isn't a usable state anywhere in the app. */
export const createPortfolio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(createPortfolioSchema)
  .handler(async ({ context, data }): Promise<PortfolioRow> => {
    const { supabase, userId } = context;

    const { data: created, error } = await supabase
      .from("portfolios")
      .insert({
        owner_id: userId,
        name: data.name,
        account_type: data.accountType,
        base_currency: data.baseCurrency,
        starting_equity: data.startingEquity,
        current_equity: data.startingEquity,
        is_active: false,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    const { error: settingsError } = await supabase
      .from("portfolio_settings")
      .insert({ portfolio_id: created.id });
    if (settingsError) throw new Error(settingsError.message);

    const { error: accountError } = await supabase.from("accounts").insert({
      owner_id: userId,
      portfolio_id: created.id,
      name: data.name,
      account_type: data.accountType,
      base_currency: data.baseCurrency,
      starting_equity: data.startingEquity,
      is_active: true,
    });
    if (accountError) throw new Error(accountError.message);

    return created;
  });

const setActivePortfolioSchema = z.object({ portfolioId: z.string().uuid() });

export const setActivePortfolio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(setActivePortfolioSchema)
  .handler(async ({ context, data }): Promise<PortfolioRow> => {
    const { supabase, userId } = context;

    // No separate ownership pre-check: the "clear others" step below only
    // ever touches the caller's own rows (owner_id filter) regardless of
    // whether portfolioId is valid, and the "activate" step's own
    // owner_id filter means a well-formed-but-foreign UUID matches zero
    // rows (PGRST116 from .single()) rather than silently activating
    // someone else's portfolio.
    const { error: clearError } = await supabase
      .from("portfolios")
      .update({ is_active: false })
      .eq("owner_id", userId)
      .neq("id", data.portfolioId);
    if (clearError) throw new Error(clearError.message);

    const { data: activated, error: activateError } = await supabase
      .from("portfolios")
      .update({ is_active: true })
      .eq("id", data.portfolioId)
      .eq("owner_id", userId)
      .select("*")
      .single();
    if (activateError) throw friendlyNotFoundError(activateError, "Portfolio not found");
    return activated;
  });

const updatePortfolioSchema = z.object({
  portfolioId: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
});

/** Updates a portfolio's own fields. Account type/currency/equity all moved to the account level — see updateAccount in accounts.functions.ts. */
export const updatePortfolio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(updatePortfolioSchema)
  .handler(async ({ context, data }): Promise<PortfolioRow> => {
    const { supabase, userId } = context;

    const payload: Database["public"]["Tables"]["portfolios"]["Update"] = {
      ...(data.name !== undefined ? { name: data.name } : {}),
    };

    // No pre-check: owner_id filter means a foreign portfolioId matches
    // zero rows (PGRST116 from .single()) instead of needing a separate
    // ownership round trip first.
    const { data: updated, error } = await supabase
      .from("portfolios")
      .update(payload)
      .eq("id", data.portfolioId)
      .eq("owner_id", userId)
      .select("*")
      .single();
    if (error) throw friendlyNotFoundError(error, "Portfolio not found");
    return updated;
  });

const updatePortfolioSettingsSchema = z.object({
  portfolioId: z.string().uuid(),
  preferredSessions: z.array(z.string()).optional(),
  preferredSymbols: z.array(z.string()).optional(),
});

/** Workspace-wide preferences that genuinely aren't per-account (risk %, equity, and compliance all moved to accounts). */
export const updatePortfolioSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(updatePortfolioSettingsSchema)
  .handler(async ({ context, data }): Promise<PortfolioSettingsRow> => {
    const { supabase } = context;

    const payload: Database["public"]["Tables"]["portfolio_settings"]["Update"] = {
      ...(data.preferredSessions !== undefined ? { preferred_sessions: data.preferredSessions } : {}),
      ...(data.preferredSymbols !== undefined ? { preferred_symbols: data.preferredSymbols } : {}),
    };

    // No pre-check: portfolio_settings' RLS USING clause already excludes
    // rows whose parent portfolio isn't the caller's, so a foreign
    // portfolioId matches zero rows (PGRST116 from .single()) rather than
    // needing a separate ownership round trip first.
    const { data: updated, error } = await supabase
      .from("portfolio_settings")
      .update(payload)
      .eq("portfolio_id", data.portfolioId)
      .select("*")
      .single();
    if (error) throw friendlyNotFoundError(error, "Portfolio not found");
    return updated;
  });
