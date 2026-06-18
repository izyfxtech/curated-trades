import React from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Pencil, Trash2, ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function TradeScreenshotView({ trades, onEdit, onDelete }) {
  if (!trades?.length) {
    return (
      <div className="bg-card rounded-xl border border-border p-12 text-center">
        <p className="text-muted-foreground">No trades found</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {trades.map(trade => {
        const isWin = (trade.pnl || 0) > 0;
        const isOpen = trade.outcome === "open" || (!trade.close_time && !trade.exit_price);
        const screenshot = trade.screenshots?.[0];

        return (
          <div key={trade.id} className="bg-card rounded-xl border border-border overflow-hidden group hover:shadow-xl transition-all duration-300">
            {/* Screenshot area */}
            <div className="relative aspect-video bg-secondary/30 overflow-hidden">
              {screenshot ? (
                <img src={screenshot} alt={trade.symbol} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/30">
                  <ImageIcon className="w-8 h-8 mb-1" />
                  <span className="text-xs">No screenshot</span>
                </div>
              )}
              {/* Overlay on hover */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              {/* Actions */}
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="secondary" size="icon" className="h-7 w-7 bg-black/60 hover:bg-black/80 border-0" onClick={() => onEdit?.(trade)}>
                  <Pencil className="w-3 h-3 text-white" />
                </Button>
                <Button variant="secondary" size="icon" className="h-7 w-7 bg-red-500/80 hover:bg-red-500 border-0" onClick={() => onDelete?.(trade)}>
                  <Trash2 className="w-3 h-3 text-white" />
                </Button>
              </div>
              {/* PnL badge overlay */}
              <div className="absolute bottom-2 left-2">
                <span className={cn(
                  "text-xs font-mono font-bold px-2 py-1 rounded-md",
                  isOpen ? "bg-primary/90 text-white" : isWin ? "bg-emerald-500/90 text-white" : "bg-red-500/90 text-white"
                )}>
                  {isOpen ? "OPEN" : (isWin ? "+" : "") + (trade.pnl?.toFixed(2) ?? "—")}
                </span>
              </div>
              {/* Screenshot count */}
              {trade.screenshots?.length > 1 && (
                <div className="absolute bottom-2 right-2 bg-black/60 rounded-md px-1.5 py-0.5 text-[10px] text-white">
                  +{trade.screenshots.length - 1}
                </div>
              )}
            </div>

            {/* Details below */}
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold font-mono text-foreground">{trade.symbol}</span>
                  <Badge variant="outline" className={cn(
                    "text-[10px] capitalize",
                    trade.direction === "long" ? "border-emerald-400/40 text-emerald-400" : "border-red-400/40 text-red-400"
                  )}>
                    {trade.direction}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {trade.close_time ? format(new Date(trade.close_time), "MMM d") : "Open"}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {trade.strategy && (
                  <Badge variant="secondary" className="text-[10px]">{trade.strategy}</Badge>
                )}
                {trade.session && (
                  <Badge variant="outline" className="text-[10px] capitalize border-muted-foreground/20 text-muted-foreground">
                    {trade.session.replace("_", " ")}
                  </Badge>
                )}
              </div>
              {trade.notes && (
                <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{trade.notes}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
