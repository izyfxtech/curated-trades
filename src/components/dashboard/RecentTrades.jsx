import React from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Link } from "react-router-dom";

export default function RecentTrades({ trades }) {
  const recent = trades
    ?.sort((a, b) => new Date(b.close_time || b.created_date) - new Date(a.close_time || a.created_date))
    .slice(0, 8);

  if (!recent?.length) {
    return (
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Recent Trades</h3>
        <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
          No trades yet
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-muted-foreground">Recent Trades</h3>
        <Link to="/trades" className="text-xs text-primary hover:text-primary/80 transition-colors">
          View all
        </Link>
      </div>
      <div className="space-y-2">
        {recent.map((trade) => {
          const isWin = (trade.pnl || 0) > 0;
          return (
            <div key={trade.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-secondary/50 transition-colors">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center",
                  isWin ? "bg-emerald-400/10" : "bg-red-400/10"
                )}>
                  {trade.direction === "long" 
                    ? <ArrowUpRight className={cn("w-4 h-4", isWin ? "text-emerald-400" : "text-red-400")} />
                    : <ArrowDownRight className={cn("w-4 h-4", isWin ? "text-emerald-400" : "text-red-400")} />
                  }
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{trade.symbol}</p>
                  <p className="text-xs text-muted-foreground">
                    {trade.close_time ? format(new Date(trade.close_time), "MMM d, h:mm a") : "—"}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className={cn(
                  "text-sm font-mono font-semibold",
                  isWin ? "text-emerald-400" : "text-red-400"
                )}>
                  {isWin ? "+" : "-"}${Math.abs(trade.pnl ?? 0).toFixed(2)}
                </p>
                {trade.strategy && (
                  <p className="text-xs text-muted-foreground">{trade.strategy}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
