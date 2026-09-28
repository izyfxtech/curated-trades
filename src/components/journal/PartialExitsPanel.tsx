// Scale-out tracker for a single open trade — records each partial exit
// (quantity, price, timestamp) as its own trade_exits row rather than
// mutating the parent trade's exit_price/quantity directly, so the fill-by-
// fill history survives even after the position is fully closed.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addTradeExit, deleteTradeExit, listTradeExits } from "@/lib/trade-exits.functions";

export function PartialExitsPanel({
  tradeId,
  portfolioId,
  totalQuantity,
}: {
  tradeId: string;
  portfolioId: string;
  totalQuantity: number;
}) {
  const queryClient = useQueryClient();
  const exitsQuery = useQuery({
    queryKey: ["trade-exits", tradeId],
    queryFn: () => listTradeExits({ data: { tradeId } }),
  });
  const exits = exitsQuery.data ?? [];
  const filled = exits.reduce((sum, exit) => sum + exit.quantity, 0);
  const remaining = Math.max(0, totalQuantity - filled);

  const [exitPrice, setExitPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [fees, setFees] = useState("0");

  function invalidateAfterChange() {
    void queryClient.invalidateQueries({ queryKey: ["trade-exits", tradeId] });
    void queryClient.invalidateQueries({ queryKey: ["trades", portfolioId] });
  }

  const addMutation = useMutation({
    mutationFn: () =>
      addTradeExit({
        data: {
          tradeId,
          exitedAt: new Date().toISOString(),
          exitPrice: Number(exitPrice),
          quantity: Number(quantity),
          fees: Number(fees || 0),
        },
      }),
    onSuccess: () => {
      invalidateAfterChange();
      setExitPrice("");
      setQuantity("");
      setFees("0");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (exitId: string) => deleteTradeExit({ data: { tradeId, exitId } }),
    onSuccess: invalidateAfterChange,
  });

  function onAddExit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const priceValid = Number.isFinite(Number(exitPrice)) && Number(exitPrice) > 0;
    const qtyValid = Number.isFinite(Number(quantity)) && Number(quantity) > 0;
    if (!priceValid || !qtyValid) return;
    addMutation.mutate();
  }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="field-label mb-0">Partial exits</span>
        <span className="font-mono text-xs text-muted-foreground">
          {filled.toLocaleString()} / {totalQuantity.toLocaleString()} filled
        </span>
      </div>

      {exits.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {exits.map((exit) => (
            <li key={exit.id} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                <span className="font-mono">
                  {exit.quantity.toLocaleString()} @ {exit.exit_price}
                </span>, {new Date(exit.exited_at).toLocaleDateString("en-US", { month: "short", day: "2-digit" })}
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
        <form onSubmit={onAddExit} className="grid grid-cols-3 gap-2">
          <Input
            type="number"
            step="any"
            placeholder="Exit price"
            value={exitPrice}
            onChange={(event) => setExitPrice(event.target.value)}
          />
          <Input
            type="number"
            step="any"
            placeholder={`Qty (≤ ${remaining})`}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={addMutation.isPending}>
            {addMutation.isPending ? "Adding…" : "Add"}
          </Button>
        </form>
      ) : (
        <p className="text-xs text-chart-2">Fully filled — trade will show as closed.</p>
      )}
    </div>
  );
}
