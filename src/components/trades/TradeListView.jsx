import React from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Pencil, Trash2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/tradeUtils";

export default function TradeListView({ trades, onEdit, onDelete }) {
  if (!trades?.length) {
    return (
      <div className="bg-card rounded-xl border border-border p-12 text-center">
        <p className="text-muted-foreground">No trades found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {trades.map(trade => {
        const isWin = (trade.pnl || 0) > 0;
        const isOpen = trade.outcome === "open" || (!trade.close_time && !trade.exit_price);

        return (
          <div key={trade.id} className={cn(
            "bg-card rounded-xl border flex items-center gap-4 px-4 py-3 hover:bg-secondary/20 transition-all group",
            isOpen ? "border-primary/20" : "border-border"
          )}>
            {/* Direction icon */}
            <div className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
              isOpen ? "bg-primary/10" : isWin ? "bg-emerald-400/10" : "bg-red-400/10"
            )}>
              {trade.direction === "long"
                ? <ArrowUpRight className={cn("w-5 h-5", isOpen ? "text-primary" : isWin ? "text-emerald-400" : "text-red-400")} />
                : <ArrowDownRight className={cn("w-5 h-5", isOpen ? "text-primary" : isWin ? "text-emerald-400" : "text-red-400")} />
              }
            </div>

            {/* Symbol & date */}
            <div className="min-w-[90px]">
              <p className="text-sm font-bold font-mono text-foreground">{trade.symbol}</p>
              <p className="text-xs text-muted-foreground">
                {trade.close_time ? format(new Date(trade.close_time), "MMM d, yyyy") : (isOpen ? "Open" : "—")}
              </p>
            </div>

            {/* Direction badge */}
            <Badge variant="outline" className={cn(
              "text-xs capitalize hidden sm:flex",
              trade.direction === "long" ? "border-emerald-400/30 text-emerald-400" : "border-red-400/30 text-red-400"
            )}>
              {trade.direction}
            </Badge>

            {/* Entry / Exit */}
            <div className="hidden md:flex items-center gap-3 text-xs font-mono text-muted-foreground flex-1">
              <span>In: <span className="text-foreground">{trade.entry_price ?? "—"}</span></span>
              <span>→</span>
              <span>Out: <span className="text-foreground">{trade.exit_price ?? (isOpen ? "—" : "—")}</span></span>
              {trade.lot_size && <span>Qty: <span className="text-foreground">{trade.lot_size}</span></span>}
            </div>

            {/* Duration */}
            {trade.duration_minutes > 0 && (
              <div className="hidden lg:flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span>{formatDuration(trade.duration_minutes)}</span>
              </div>
            )}

            {/* Strategy */}
            {trade.strategy && (
              <Badge variant="secondary" className="text-xs hidden lg:flex">{trade.strategy}</Badge>
            )}

            {/* PnL */}
            <div className="ml-auto text-right">
              <p className={cn(
                "text-sm font-mono font-bold",
                isOpen ? "text-primary" : isWin ? "text-emerald-400" : "text-red-400"
              )}>
                {isOpen ? "OPEN" : (isWin ? "+" : "") + (trade.pnl?.toFixed(2) ?? "—")}
              </p>
              {trade.net_pnl !== undefined && trade.net_pnl !== trade.pnl && !isOpen && (
                <p className="text-[10px] text-muted-foreground">net: {trade.net_pnl?.toFixed(2)}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit?.(trade)}>
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete?.(trade)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
