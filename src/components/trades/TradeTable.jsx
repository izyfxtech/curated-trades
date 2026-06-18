import React from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Pencil, Trash2, Share2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";

export default function TradeTable({ trades, onEdit, onDelete, onShare }) {
  if (!trades?.length) {
    return (
      <div className="bg-card rounded-xl border border-border p-12 text-center">
        <p className="text-muted-foreground">No trades found</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/30 hover:bg-secondary/30">
              <TableHead className="text-xs font-semibold uppercase tracking-wider">Symbol</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">Direction</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">Date</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">P&L</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">R:R</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">Strategy</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">Rating</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.map((trade) => {
              const isWin = (trade.pnl || 0) > 0;
              const isOpen = trade.outcome === "open" || (!trade.close_time && !trade.exit_price);
              return (
                <TableRow key={trade.id} className="hover:bg-secondary/20 transition-colors">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-6 h-6 rounded flex items-center justify-center",
                        isWin ? "bg-emerald-400/10" : "bg-red-400/10"
                      )}>
                        {trade.direction === "long" 
                          ? <ArrowUpRight className={cn("w-3.5 h-3.5", isWin ? "text-emerald-400" : "text-red-400")} />
                          : <ArrowDownRight className={cn("w-3.5 h-3.5", isWin ? "text-emerald-400" : "text-red-400")} />
                        }
                      </div>
                      <span className="font-medium text-sm">{trade.symbol}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn(
                      "text-xs capitalize",
                      trade.direction === "long" ? "border-emerald-400/30 text-emerald-400" : "border-red-400/30 text-red-400"
                    )}>
                      {trade.direction || "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {trade.close_time ? format(new Date(trade.close_time), "MMM d, yyyy") : "—"}
                  </TableCell>
                  <TableCell>
                    {isOpen ? (
                      <span className="font-mono font-semibold text-sm text-primary">OPEN</span>
                    ) : (
                      <span className={cn(
                        "font-mono font-semibold text-sm",
                        isWin ? "text-emerald-400" : "text-red-400"
                      )}>
                        {isWin ? "+" : ""}{trade.pnl?.toFixed(2)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm font-mono text-muted-foreground">
                    {trade.risk_reward ? `${trade.risk_reward.toFixed(1)}R` : "—"}
                  </TableCell>
                  <TableCell>
                    {trade.strategy ? (
                      <Badge variant="secondary" className="text-xs">{trade.strategy}</Badge>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    {trade.rating ? (
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map(s => (
                          <div key={s} className={cn(
                            "w-1.5 h-4 rounded-sm",
                            s <= trade.rating ? "bg-primary" : "bg-secondary"
                          )} />
                        ))}
                      </div>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit?.(trade)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-primary/70 hover:text-primary" onClick={() => onShare?.(trade)}>
                        <Share2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete?.(trade)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
