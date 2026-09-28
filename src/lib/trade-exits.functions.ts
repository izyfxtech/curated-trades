// Server functions for partial exits. A trade can be closed in one shot (the
// common case, handled entirely in trades.functions.ts) or filled across
// multiple exits logged here — either way, the parent trade's aggregate
// fields are recomputed from the *full* set of exits via the same calc layer,
// so a trade closed in one exit and one closed across five produce numbers
// on the same footing.
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  CALCULATION_VERSION,
  calculateExitPnl,
  calculateHoldingSeconds,
  calculateTrade,
  type Direction,
  type ExitInput,
} from "@/lib/trade-calc";

type TradeRow = Database["public"]["Tables"]["trades"]["Row"];
type TradeExitRow = Database["public"]["Tables"]["trade_exits"]["Row"];

function asDirection(value: string): Direction {
  return value === "short" ? "short" : "long";
}

async function loadOwnedTrade(
  supabase: SupabaseClient<Database>,
  userId: string,
  tradeId: string,
): Promise<TradeRow> {
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .eq("id", tradeId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Trade not found");
  return data;
}

/** Recomputes and persists the parent trade's aggregate fields from its full set of exits. */
async function recomputeTradeFromExits(
  supabase: SupabaseClient<Database>,
  trade: TradeRow,
): Promise<TradeRow> {
  const { data: exits, error } = await supabase
    .from("trade_exits")
    .select("*")
    .eq("trade_id", trade.id)
    .order("exited_at", { ascending: true });
  if (error) throw new Error(error.message);

  const exitList = exits ?? [];
  const exitInputs: ExitInput[] = exitList.map((exit) => ({
    exitPrice: exit.exit_price,
    quantity: exit.quantity,
    fees: exit.fees,
  }));
  const filledQuantity = exitInputs.reduce((sum, exit) => sum + exit.quantity, 0);
  const isFullyFilled = exitList.length > 0 && filledQuantity >= trade.quantity;
  const latestExit = exitList.length > 0 ? exitList[exitList.length - 1] : undefined;

  const calc = calculateTrade({
    direction: asDirection(trade.direction),
    entryPrice: trade.entry_price,
    quantity: trade.quantity,
    entryFees: trade.fees,
    spreadCost: trade.spread_cost,
    swapFunding: trade.swap_funding,
    stopLoss: trade.stop_loss,
    takeProfit: trade.take_profit,
    exits: exitInputs,
  });

  const nextStatus =
    trade.status === "cancelled" || trade.status === "incomplete"
      ? trade.status
      : isFullyFilled
        ? "closed"
        : "open";
  const closedAt = isFullyFilled && latestExit ? latestExit.exited_at : null;

  const payload: Database["public"]["Tables"]["trades"]["Update"] = {
    gross_pnl: calc.grossPnl,
    net_pnl: calc.netPnl,
    realized_r_multiple: calc.realizedRMultiple,
    move_percent: calc.movePercent,
    outcome: calc.outcome,
    exit_price: calc.averageExitPrice,
    status: nextStatus,
    closed_at: closedAt,
    holding_seconds: closedAt ? calculateHoldingSeconds(trade.opened_at, closedAt) : null,
    calculation_version: CALCULATION_VERSION,
  };

  const { data: updated, error: updateError } = await supabase
    .from("trades")
    .update(payload)
    .eq("id", trade.id)
    .select("*")
    .single();
  if (updateError) throw new Error(updateError.message);
  return updated;
}

export const listTradeExits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ tradeId: z.string().uuid() }))
  .handler(async ({ context, data }): Promise<TradeExitRow[]> => {
    const { supabase, userId } = context;
    await loadOwnedTrade(supabase, userId, data.tradeId);
    const { data: exits, error } = await supabase
      .from("trade_exits")
      .select("*")
      .eq("trade_id", data.tradeId)
      .order("exited_at", { ascending: true });
    if (error) throw new Error(error.message);
    return exits ?? [];
  });

const addTradeExitSchema = z.object({
  tradeId: z.string().uuid(),
  exitedAt: z.string().datetime(),
  exitPrice: z.number().positive(),
  quantity: z.number().positive(),
  fees: z.number().min(0).default(0),
});

export const addTradeExit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(addTradeExitSchema)
  .handler(async ({ context, data }): Promise<TradeRow> => {
    const { supabase, userId } = context;
    const trade = await loadOwnedTrade(supabase, userId, data.tradeId);

    const exitPnl = calculateExitPnl({
      direction: asDirection(trade.direction),
      entryPrice: trade.entry_price,
      exitPrice: data.exitPrice,
      quantity: data.quantity,
      fees: data.fees,
    });

    const { error: insertError } = await supabase.from("trade_exits").insert({
      trade_id: trade.id,
      owner_id: userId,
      exited_at: data.exitedAt,
      exit_price: data.exitPrice,
      quantity: data.quantity,
      fees: data.fees,
      gross_pnl: exitPnl.grossPnl,
      net_pnl: exitPnl.netPnl,
    });
    if (insertError) throw new Error(insertError.message);

    return recomputeTradeFromExits(supabase, trade);
  });

const deleteTradeExitSchema = z.object({ tradeId: z.string().uuid(), exitId: z.string().uuid() });

export const deleteTradeExit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(deleteTradeExitSchema)
  .handler(async ({ context, data }): Promise<TradeRow> => {
    const { supabase, userId } = context;
    const trade = await loadOwnedTrade(supabase, userId, data.tradeId);

    const { error } = await supabase
      .from("trade_exits")
      .delete()
      .eq("id", data.exitId)
      .eq("owner_id", userId)
      .eq("trade_id", trade.id);
    if (error) throw new Error(error.message);

    return recomputeTradeFromExits(supabase, trade);
  });
