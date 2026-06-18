import React, { useMemo } from "react";
import { useTradeFilter } from "@/lib/TradeFilterContext";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, BookOpen, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Timeline() {
  const { filteredTrades: trades, tradesLoading: isLoading } = useTradeFilter();

  const events = useMemo(() => {
    const list = [];
    trades.forEach(t => {
      if (t.open_time) {
        list.push({ type: "open", trade: t, date: new Date(t.open_time) });
      }
      if (t.close_time) {
        list.push({ type: "close", trade: t, date: new Date(t.close_time) });
      }
      if (t.notes) {
        list.push({ type: "journal", trade: t, date: new Date(t.close_time || t.created_at) });
      }
    });
    return list.sort((a, b) => b.date - a.date);
  }, [trades]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground">Timeline</h1>
        <p className="text-sm text-muted-foreground mt-1">Chronological history of all trade activity</p>
      </div>

      {!events.length ? (
        <div className="bg-card rounded-xl border border-dashed border-border p-12 text-center">
          <p className="text-muted-foreground">No activity yet</p>
        </div>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />

          <div className="space-y-4">
            {events.map((event, idx) => {
              const { type, trade, date } = event;
              const isWin = (trade.pnl || 0) > 0;
              const isOpen = type === "open";
              const isClose = type === "close";
              const isJournal = type === "journal";

              return (
                <div key={`${trade.id}-${type}-${idx}`} className="flex gap-4 relative">
                  {/* Dot */}
                  <div className={cn(
                    "w-10 h-10 rounded-full border-2 flex items-center justify-center flex-shrink-0 z-10 bg-card",
                    isOpen && "border-primary",
                    isClose && (isWin ? "border-emerald-400" : "border-red-400"),
                    isJournal && "border-muted-foreground"
                  )}>
                    {isOpen && <ArrowUpRight className="w-4 h-4 text-primary" />}
                    {isClose && (isWin
                      ? <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                      : <ArrowDownRight className="w-4 h-4 text-red-400" />
                    )}
                    {isJournal && <BookOpen className="w-4 h-4 text-muted-foreground" />}
                  </div>

                  {/* Content */}
                  <div className="flex-1 bg-card rounded-xl border border-border p-4 mb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">{trade.symbol}</span>
                          <Badge variant="outline" className={cn(
                            "text-[10px] capitalize",
                            trade.direction === "long" ? "border-emerald-400/30 text-emerald-400" : "border-red-400/30 text-red-400"
                          )}>
                            {trade.direction}
                          </Badge>
                          <Badge variant="outline" className={cn(
                            "text-[10px]",
                            isOpen && "border-primary/30 text-primary",
                            isClose && (isWin ? "border-emerald-400/30 text-emerald-400" : "border-red-400/30 text-red-400"),
                            isJournal && "border-muted-foreground/30 text-muted-foreground"
                          )}>
                            {isOpen ? "Opened" : isClose ? "Closed" : "Reviewed"}
                          </Badge>
                          {trade.strategy && (
                            <Badge variant="secondary" className="text-[10px]">{trade.strategy}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(date, "MMM d, yyyy · HH:mm")}
                        </p>
                      </div>
                      {isClose && (
                        <span className={cn(
                          "text-sm font-mono font-bold flex-shrink-0",
                          isWin ? "text-emerald-400" : "text-red-400"
                        )}>
                          {isWin ? "+" : ""}{trade.pnl?.toFixed(2)}
                        </span>
                      )}
                    </div>

                    {/* Screenshots on close events */}
                    {isClose && trade.screenshots?.length > 0 && (
                      <div className="flex gap-2 mt-3 flex-wrap">
                        {trade.screenshots.slice(0, 3).map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                            <img src={url} alt="" className="w-24 h-16 rounded-lg object-cover border border-border hover:opacity-90 transition-opacity" />
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Notes on journal events */}
                    {isJournal && trade.notes && (
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-2 italic">
                        "{trade.notes}"
                      </p>
                    )}

                    {/* Rating on close */}
                    {isClose && trade.rating && (
                      <div className="flex items-center gap-1 mt-2">
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
        </div>
      )}
    </div>
  );
}
