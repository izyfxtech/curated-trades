// Server functions for prop-firm compliance. Rules are per-account now, not
// per-portfolio — three prop evaluations in one portfolio each need their
// own independent daily-loss/drawdown tracking, which was the entire
// reason accounts exist as a real unit (see the accounts migration
// comment). There is deliberately no portfolio-wide aggregate compliance
// view: summing three accounts' drawdown % would produce a number that
// looks authoritative and means nothing, since each account has its own
// independent limit and its own breach condition. When the UI needs "all
// compliance in this portfolio", it calls listComplianceOverviewsForPortfolio
// and renders one card per account, never a merged figure.
//
// The actual math lives in prop-firm-calc.ts — this file's job is only to
// fetch rows, hand them to the pure calculator, persist any newly-detected
// rule events (an upsert with ignoreDuplicates, since the unique (account_id,
// event_type, occurred_on) constraint means recomputing on every page load
// never double-writes the same day's event), and return everything the
// dashboard needs in one round trip.
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { friendlyNotFoundError } from "@/lib/db-errors";
import { computeComplianceStatus, type ComplianceStatus } from "@/lib/prop-firm-calc";
import type { Database } from "@/integrations/supabase/types";

type PropFirmRulesRow = Database["public"]["Tables"]["prop_firm_rules"]["Row"];
type PropFirmRuleEventRow = Database["public"]["Tables"]["prop_firm_rule_events"]["Row"];
type AccountRow = Database["public"]["Tables"]["accounts"]["Row"];

export interface ComplianceOverview {
  accountId: string;
  accountName: string;
  rules: PropFirmRulesRow | null;
  status: ComplianceStatus | null;
  events: PropFirmRuleEventRow[];
}

const accountIdSchema = z.object({ accountId: z.string().uuid() });

async function loadComplianceOverview(
  supabase: SupabaseClient<Database>,
  userId: string,
  account: Pick<AccountRow, "id" | "name" | "starting_equity">,
): Promise<ComplianceOverview> {
  const { data: rules, error: rulesError } = await supabase
    .from("prop_firm_rules")
    .select("*")
    .eq("account_id", account.id)
    .eq("owner_id", userId)
    .maybeSingle();
  if (rulesError) throw new Error(rulesError.message);

  if (!rules) {
    return { accountId: account.id, accountName: account.name, rules: null, status: null, events: [] };
  }

  const { data: closedTrades, error: tradesError } = await supabase
    .from("trades")
    .select("id, closed_at, net_pnl")
    .eq("owner_id", userId)
    .eq("account_id", account.id)
    .eq("status", "closed")
    .not("closed_at", "is", null);
  if (tradesError) throw new Error(tradesError.message);

  const status = computeComplianceStatus(
    {
      timezone: rules.timezone,
      calculationBasis: rules.calculation_basis as "starting_balance" | "current_balance" | "high_water_mark",
      maxDailyLossPercent: rules.max_daily_loss_percent,
      maxTotalDrawdownPercent: rules.max_total_drawdown_percent,
      profitTargetPercent: rules.profit_target_percent,
      minTradingDays: rules.min_trading_days,
      maxTradingDays: rules.max_trading_days,
      consistencyPercent: rules.consistency_percent,
    },
    account.starting_equity,
    (closedTrades ?? [])
      .filter((t): t is typeof t & { closed_at: string } => t.closed_at != null)
      .map((t) => ({ id: t.id, closedAt: t.closed_at, netPnl: t.net_pnl ?? 0 })),
  );

  if (status.events.length > 0) {
    const { error: insertEventsError } = await supabase.from("prop_firm_rule_events").upsert(
      status.events.map((event) => ({
        owner_id: userId,
        account_id: account.id,
        event_type: event.eventType,
        severity: event.severity,
        message: event.message,
        occurred_on: event.occurredOn,
      })),
      { onConflict: "account_id,event_type,occurred_on", ignoreDuplicates: true },
    );
    if (insertEventsError) throw new Error(insertEventsError.message);
  }

  const { data: events, error: eventsError } = await supabase
    .from("prop_firm_rule_events")
    .select("*")
    .eq("owner_id", userId)
    .eq("account_id", account.id)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);
  if (eventsError) throw new Error(eventsError.message);

  return { accountId: account.id, accountName: account.name, rules, status, events: events ?? [] };
}

/** Rule profile + freshly-computed status + recent audit-trail events for one account, in one call. */
export const getComplianceOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(accountIdSchema)
  .handler(async ({ context, data }): Promise<ComplianceOverview> => {
    const { supabase, userId } = context;

    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id, name, starting_equity")
      .eq("id", data.accountId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (accountError) throw new Error(accountError.message);
    if (!account) throw new Error("Account not found");

    return loadComplianceOverview(supabase, userId, account);
  });

/** One overview per account in a portfolio — the "all accounts" compliance view. Never merged into one number; see the file header for why. */
export const listComplianceOverviewsForPortfolio = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ portfolioId: z.string().uuid() }))
  .handler(async ({ context, data }): Promise<ComplianceOverview[]> => {
    const { supabase, userId } = context;

    const { data: accounts, error: accountsError } = await supabase
      .from("accounts")
      .select("id, name, starting_equity")
      .eq("owner_id", userId)
      .eq("portfolio_id", data.portfolioId)
      .eq("is_archived", false)
      .order("name");
    if (accountsError) throw new Error(accountsError.message);

    return Promise.all((accounts ?? []).map((account) => loadComplianceOverview(supabase, userId, account)));
  });

const upsertRulesSchema = z.object({
  accountId: z.string().uuid(),
  isActive: z.boolean().default(true),
  timezone: z.string().trim().min(1).max(64),
  calculationBasis: z.enum(["starting_balance", "current_balance", "high_water_mark"]),
  maxDailyLossPercent: z.number().positive().max(100),
  maxTotalDrawdownPercent: z.number().positive().max(100),
  profitTargetPercent: z.number().positive().nullable().optional(),
  minTradingDays: z.number().int().positive().nullable().optional(),
  maxTradingDays: z.number().int().positive().nullable().optional(),
  consistencyPercent: z.number().positive().max(100).nullable().optional(),
  allowWeekendHolding: z.boolean().default(true),
  allowNewsTrading: z.boolean().default(true),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const upsertPropFirmRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(upsertRulesSchema)
  .handler(async ({ context, data }): Promise<PropFirmRulesRow> => {
    const { supabase, userId } = context;

    const { data: saved, error } = await supabase
      .from("prop_firm_rules")
      .upsert(
        {
          owner_id: userId,
          account_id: data.accountId,
          is_active: data.isActive,
          timezone: data.timezone,
          calculation_basis: data.calculationBasis,
          max_daily_loss_percent: data.maxDailyLossPercent,
          max_total_drawdown_percent: data.maxTotalDrawdownPercent,
          profit_target_percent: data.profitTargetPercent ?? null,
          min_trading_days: data.minTradingDays ?? null,
          max_trading_days: data.maxTradingDays ?? null,
          consistency_percent: data.consistencyPercent ?? null,
          allow_weekend_holding: data.allowWeekendHolding,
          allow_news_trading: data.allowNewsTrading,
          notes: data.notes ?? null,
        },
        { onConflict: "account_id" },
      )
      .select("*")
      .single();
    if (error) throw friendlyNotFoundError(error, "Account not found");
    return saved;
  });

export const deletePropFirmRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(accountIdSchema)
  .handler(async ({ context, data }): Promise<void> => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("prop_firm_rules").delete().eq("account_id", data.accountId).eq("owner_id", userId);
    if (error) throw new Error(error.message);
  });
