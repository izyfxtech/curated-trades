import React from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Calendar } from "lucide-react";

export default function CalendarDayDetail({ date, trades }) {
  if (!date) {
    return (
      <div className="bg-card rounded-xl border border-border p-6 flex flex-col items-center justify-center text-center min-h-[300px]">
        <Calendar className="w-10 h-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">Select a day to view details</p>
      </div>
    );
  }

  const totalPnl = trades.reduce((s, t) => s + (t.net_pnl || t.pnl || 0), 0);
  const wins = trades.filter(t => (t.pnl || 0) > 0).length;

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          {format(date, "EEEE, MMMM d")}
        </h3>
        {trades.length > 0 ? (
          <div className="flex items-baseline gap-4 mt-1">
            <span className={cn(
              "text-xl font-mono font-bold",
              totalPnl >= 0 ? "text-emerald-400" : "text-red-400"
            )}>
              {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
            </span>
            <span className="text-xs text-muted-foreground">
              {trades.length} trades · {wins}W / {trades.length - wins}L
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground mt-1">No trades</p>
        )}
      </div>

      {trades.length > 0 && (
        <div className="space-y-2">
          {trades.map(trade => {
            const isWin = (trade.pnl || 0) > 0;
            return (
              <div key={trade.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-secondary/30">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-6 h-6 rounded flex items-center justify-center",
                    isWin ? "bg-emerald-400/10" : "bg-red-400/10"
                  )}>
                    {trade.direction === "long"
                      ? <ArrowUpRight className={cn("w-3 h-3", isWin ? "text-emerald-400" : "text-red-400")} />
                      : <ArrowDownRight className={cn("w-3 h-3", isWin ? "text-emerald-400" : "text-red-400")} />
                    }
                  </div>
                  <div>
                    <p className="text-xs font-medium text-foreground">{trade.symbol}</p>
                    <p className="text-[10px] text-muted-foreground">{trade.strategy || "—"}</p>
                  </div>
                </div>
                <span className={cn(
                  "text-xs font-mono font-semibold",
                  isWin ? "text-emerald-400" : "text-red-400"
                )}>
                  {isWin ? "+" : ""}{trade.pnl?.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
