// Scale-out tracker for a single open trade — records each partial exit
// (quantity, price, timestamp) as its own trade_exits row rather than
// mutating the parent trade's exit_price/quantity directly, so the fill-by-
// fill history survives even after the position is fully closed.
//
// The add-exit mini form is a TanStack Form (zod-validated, reset on success);
// this panel renders *inside* the trade modal's own <form>, which is why
// `formProps` stops the submit event from bubbling to it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { formProps, useAppForm } from "@/lib/form";
import { queryKeys, tradeExitsQueryOptions } from "@/lib/queries";
import { addTradeExit, deleteTradeExit } from "@/lib/trade-exits.functions";

const positive = (message: string) =>
  z.string().refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, message);
const addExitSchema = z.object({ exitPrice: positive("Enter an exit price"), quantity: positive("Enter a size") });

export function PartialExitsPanel({
  tradeId,
  portfolioId,
  totalQuantity,
  unit = "units",
}: {
  tradeId: string;
  portfolioId: string;
  totalQuantity: number;
  /** "lots" for forex/metal trades (calculation v2); "units" for crypto and pre-lots trades. */
  unit?: "lots" | "units";
}) {
  const queryClient = useQueryClient();
  const exitsOptions = tradeExitsQueryOptions(tradeId);
  const { data: exits = [] } = useQuery(exitsOptions);
  // Rounded so 0.1 + 0.2 style float noise never leaves "0.30000000000000004 lots" on screen.
  const round = (value: number) => Number(value.toFixed(8));
  const filled = round(exits.reduce((sum, exit) => sum + exit.quantity, 0));
  const remaining = Math.max(0, round(totalQuantity - filled));
  const fmt = (value: number) =>
    unit === "lots"
      ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })
      : value.toLocaleString(undefined, { maximumFractionDigits: 8 });

  function invalidateAfterChange() {
    void queryClient.invalidateQueries({ queryKey: exitsOptions.queryKey });
    void queryClient.invalidateQueries({ queryKey: queryKeys.trades(portfolioId) });
  }

  const addMutation = useMutation({
    mutationFn: (values: z.infer<typeof addExitSchema>) =>
      addTradeExit({
        data: {
          tradeId,
          exitedAt: new Date().toISOString(),
          exitPrice: Number(values.exitPrice),
          quantity: Number(values.quantity),
          fees: 0,
        },
      }),
    onSuccess: () => {
      invalidateAfterChange();
      form.reset();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (exitId: string) => deleteTradeExit({ data: { tradeId, exitId } }),
    onSuccess: invalidateAfterChange,
  });

  const form = useAppForm({
    defaultValues: { exitPrice: "", quantity: "" },
    validators: { onSubmit: addExitSchema },
    onSubmit: ({ value }) => addMutation.mutate(value),
  });

  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="field-label mb-0">Partial exits</span>
        <span className="font-mono text-xs text-muted-foreground">
          {fmt(filled)} / {fmt(totalQuantity)} {unit} filled
        </span>
      </div>

      {exits.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {exits.map((exit) => (
            <li key={exit.id} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                <span className="font-mono">
                  {fmt(exit.quantity)} {unit} @ {exit.exit_price}
                </span>
                , {new Date(exit.exited_at).toLocaleDateString("en-US", { month: "short", day: "2-digit" })}
              </span>
              <span className="flex items-center gap-2">
                <span className={`font-mono ${(exit.net_pnl ?? 0) >= 0 ? "text-chart-2" : "text-destructive"}`}>
                  {(exit.net_pnl ?? 0) >= 0 ? "+" : ""}
                  {(exit.net_pnl ?? 0).toFixed(2)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label="Delete exit"
                  onClick={() => {
                    if (window.confirm("Delete this partial exit? This recalculates the trade's realized P&L and can't be undone.")) {
                      deleteMutation.mutate(exit.id);
                    }
                  }}
                >
                  <Trash2 className="size-3" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {remaining > 0 ? (
        <form {...formProps(form)} className="grid grid-cols-3 items-start gap-2">
          <form.AppField name="exitPrice">
            {(field) => <field.TextField type="number" step="any" placeholder="Exit price" />}
          </form.AppField>
          <form.AppField name="quantity">
            {(field) => (
              <field.TextField
                type="number"
                step={unit === "lots" ? "0.01" : "any"}
                placeholder={`${unit === "lots" ? "Lots" : "Qty"} (≤ ${fmt(remaining)})`}
              />
            )}
          </form.AppField>
          <form.AppForm>
            <form.SubmitButton size="sm" pendingLabel="Adding…" pending={addMutation.isPending}>
              Add
            </form.SubmitButton>
          </form.AppForm>
        </form>
      ) : (
        <p className="text-xs text-chart-2">Fully filled — trade will show as closed.</p>
      )}
    </div>
  );
}
