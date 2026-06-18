import React, { useState } from "react";
import { X, Search, Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import WidgetPreview from "@/components/widgets/WidgetPreview";

export const DASHBOARD_WIDGETS = [
  { id: "stat_pnl",       label: "Net P&L",             category: "stats" },
  { id: "stat_winrate",   label: "Win Rate",             category: "stats" },
  { id: "stat_trades",    label: "Total Trades",         category: "stats" },
  { id: "stat_factor",    label: "Profit Factor",        category: "stats" },
  { id: "stat_avgwin",    label: "Avg Win",              category: "stats" },
  { id: "stat_avgloss",   label: "Avg Loss",             category: "stats" },
  { id: "equity_curve",   label: "Equity Curve",         category: "charts" },
  { id: "win_loss_chart", label: "Daily P&L Bars",       category: "charts" },
  { id: "win_loss_dist",  label: "Win/Loss Distribution",category: "charts" },
  { id: "session_analysis",label: "Session Analysis",    category: "charts" },
  { id: "recent_trades",  label: "Recent Trades",        category: "tables" },
  { id: "strategy_breakdown",label: "Strategy Breakdown",category: "tables" },
];

// Keep ALL_WIDGETS export for backwards compat
export const ALL_WIDGETS = DASHBOARD_WIDGETS;

const CATS = ["all", "stats", "charts", "tables"];

export default function AddWidgetSidebar({ activeWidgets, onAdd, onClose }) {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");

  const filtered = DASHBOARD_WIDGETS.filter(w => {
    const matchCat = cat === "all" || w.category === cat;
    const matchSearch = !search || w.label.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-80 bg-card border-l border-border shadow-2xl flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h2 className="font-heading font-bold text-foreground text-base">Add Widgets</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Click to add to your dashboard</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center gap-2 bg-secondary/40 border border-border rounded-lg px-3 py-2">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search widgets…"
            className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none flex-1"
          />
        </div>
      </div>

      <div className="flex gap-1.5 px-4 py-2 flex-wrap">
        {CATS.map(c => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize",
              cat === c ? "bg-primary text-primary-foreground" : "bg-secondary/40 text-muted-foreground hover:text-foreground"
            )}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-1">
        <div className="grid grid-cols-1 gap-3">
          {filtered.map(widget => {
            const isActive = activeWidgets.includes(widget.id);
            return (
              <button
                key={widget.id}
                disabled={isActive}
                onClick={() => !isActive && onAdd(widget.id)}
                className={cn(
                  "text-left rounded-xl border transition-all p-3 group",
                  isActive
                    ? "border-primary/30 bg-primary/5 opacity-70 cursor-not-allowed"
                    : "border-border bg-card hover:border-primary/50 hover:shadow-md cursor-pointer"
                )}
              >
                {/* Visual preview */}
                <div className="mb-2.5">
                  <WidgetPreview id={widget.id} />
                </div>
                {/* Label row */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-foreground">{widget.label}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{widget.category}</p>
                  </div>
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center transition-colors",
                    isActive ? "bg-primary/20 text-primary" : "bg-secondary group-hover:bg-primary group-hover:text-primary-foreground"
                  )}>
                    {isActive ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                  </div>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No widgets found</p>
          )}
        </div>
      </div>
    </div>
  );
}
