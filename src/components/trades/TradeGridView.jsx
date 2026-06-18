import React from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Pencil, Trash2, Star, ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function TradeGridView({ trades, onEdit, onDelete }) {
  if (!trades?.length) {
    return (
      <div className="bg-card rounded-xl border border-border p-12 text-center">
        <p className="text-muted-foreground">No trades found</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {trades.map(trade => {
        const isWin = (trade.pnl || 0) > 0;
        const isOpen = trade.outcome === "open" || (!trade.close_time && !trade.exit_price);
        return (
          <div key={trade.id} className={cn(
            "bg-card rounded-xl border overflow-hidden hover:shadow-lg transition-all duration-300 group relative",
            isOpen ? "border-primary/30" : isWin ? "border-emerald-400/20 hover:border-emerald-400/40" : "border-red-400/20 hover:border-red-400/40"
          )}>
            {/* Header bar */}
            <div className={cn(
              "h-1 w-full",
              isOpen ? "bg-primary" : isWin ? "bg-emerald-400" : "bg-red-400"
            )} />

            <div className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold font-mono text-foreground">{trade.symbol}</span>
                    <Badge variant="outline" className={cn(
                      "text-[10px] capitalize",
                      trade.direction === "long" ? "border-emerald-400/40 text-emerald-400" : "border-red-400/40 text-red-400"
                    )}>
                      {trade.direction}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {trade.close_time ? format(new Date(trade.close_time), "MMM d, yyyy") : (trade.open_time ? format(new Date(trade.open_time), "MMM d, yyyy") : "—")}
                  </p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onEdit?.(trade)}>
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => onDelete?.(trade)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              <div className={cn(
                "text-xl font-mono font-bold mb-3",
                isOpen ? "text-primary" : isWin ? "text-emerald-400" : "text-red-400"
              )}>
                {isOpen ? "Open" : (isWin ? "+" : "") + (trade.pnl?.toFixed(2) ?? "—")}
              </div>

              <div className="grid grid-cols-2 gap-1.5 text-xs mb-3">
                <div className="bg-secondary/30 rounded px-2 py-1">
                  <span className="text-muted-foreground">Entry</span>
                  <span className="font-mono ml-1 text-foreground">{trade.entry_price ?? "—"}</span>
                </div>
                <div className="bg-secondary/30 rounded px-2 py-1">
                  <span className="text-muted-foreground">Exit</span>
                  <span className="font-mono ml-1 text-foreground">{trade.exit_price ?? "—"}</span>
                </div>
                {trade.risk_reward && (
                  <div className="bg-secondary/30 rounded px-2 py-1">
                    <span className="text-muted-foreground">R:R</span>
                    <span className="font-mono ml-1 text-foreground">{trade.risk_reward.toFixed(1)}R</span>
                  </div>
                )}
                {trade.lot_size && (
                  <div className="bg-secondary/30 rounded px-2 py-1">
                    <span className="text-muted-foreground">Qty</span>
                    <span className="font-mono ml-1 text-foreground">{trade.lot_size}</span>
                  </div>
                )}
              </div>

              {trade.strategy && (
                <Badge variant="secondary" className="text-[10px] mb-2">{trade.strategy}</Badge>
              )}

              {trade.rating && (
                <div className="flex gap-0.5 mt-1">
                  {[1,2,3,4,5].map(s => (
                    <Star key={s} className={cn("w-3 h-3", s <= trade.rating ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground")} />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
