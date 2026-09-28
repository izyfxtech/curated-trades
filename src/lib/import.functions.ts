// Server function for bulk CSV import. Parsing/normalization happens
// client-side (src/lib/csv.ts) so the person can review a preview before
// committing; this function takes already-normalized rows, re-derives every
// financial field through the same calc layer as manual entry
// (buildTradePayload), and records per-row provenance in import_rows so a
// bad import is auditable rather than silently mixed into the journal.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { assertOwnsAccountsInPortfolio, buildTradePayload } from "@/lib/trades.functions";

type ImportBatchRow = Database["public"]["Tables"]["import_batches"]["Row"];

const importRowSchema = z.object({
  symbol: z.string().trim().min(1).max(20),
  direction: z.enum(["long", "short"]),
  status: z.enum(["open", "closed", "cancelled", "incomplete"]),
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive().nullable(),
  quantity: z.number().positive(),
  stopLoss: z.number().positive().nullable(),
  takeProfit: z.number().positive().nullable(),
  fees: z.number().min(0),
  isPlanned: z.boolean(),
  notes: z.string().nullable(),
});

const importTradesSchema = z.object({
  portfolioId: z.string().uuid(),
  accountId: z.string().uuid(),
  fileName: z.string().max(200).optional(),
  rows: z.array(importRowSchema).min(1).max(2000),
});

export const importTrades = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(importTradesSchema)
  .handler(async ({ context, data }): Promise<ImportBatchRow> => {
    const { supabase, userId } = context;
    // Unlike the single-row create/update paths elsewhere in the app, this
    // pre-check stays: without it, a bad portfolioId/accountId would fail
    // silently row by row inside the loop below (RLS still blocks every
    // insert, but only after paying for up to 2000 wasted round trips). One
    // check up front is worth it here specifically.
    await assertOwnsAccountsInPortfolio(supabase, userId, data.portfolioId, [data.accountId]);

    const { data: batch, error: batchError } = await supabase
      .from("import_batches")
      .insert({
        owner_id: userId,
        portfolio_id: data.portfolioId,
        source: "csv",
        file_name: data.fileName ?? null,
        total_rows: data.rows.length,
        status: "processing",
      })
      .select("*")
      .single();
    if (batchError) throw new Error(batchError.message);

    let imported = 0;
    let invalid = 0;

    for (let i = 0; i < data.rows.length; i++) {
      const row = data.rows[i];
      if (!row) continue;
      const rowNumber = i + 1;

      try {
        const payload = {
          ...buildTradePayload({
            portfolioId: data.portfolioId,
            accountId: data.accountId,
            symbol: row.symbol,
            direction: row.direction,
            status: row.status,
            openedAt: row.openedAt,
            closedAt: row.closedAt,
            entryPrice: row.entryPrice,
            exitPrice: row.exitPrice,
            quantity: row.quantity,
            stopLoss: row.stopLoss,
            takeProfit: row.takeProfit,
            fees: row.fees,
            spreadCost: 0,
            swapFunding: 0,
            isPlanned: row.isPlanned,
            disciplineScore: null,
            notes: row.notes,
            tagIds: [],
          }),
          owner_id: userId,
          source: "import",
          import_batch_id: batch.id,
        };

        const { error: insertError } = await supabase.from("trades").insert(payload);
        if (insertError) throw new Error(insertError.message);

        imported += 1;
        await supabase.from("import_rows").insert({
          batch_id: batch.id,
          owner_id: userId,
          row_number: rowNumber,
          raw_data: row,
          status: "imported",
        });
      } catch (rowError) {
        invalid += 1;
        const message = rowError instanceof Error ? rowError.message : String(rowError);
        await supabase.from("import_rows").insert({
          batch_id: batch.id,
          owner_id: userId,
          row_number: rowNumber,
          raw_data: row,
          status: "invalid",
          validation_errors: [message],
        });
      }
    }

    const { data: updatedBatch, error: updateError } = await supabase
      .from("import_batches")
      .update({
        status: "completed",
        valid_rows: imported,
        invalid_rows: invalid,
        imported_rows: imported,
      })
      .eq("id", batch.id)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);
    return updatedBatch;
  });
