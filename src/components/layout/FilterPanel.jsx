import React, { useMemo } from "react";
import { X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTradeFilter } from "@/lib/TradeFilterContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/* ── Preset date buttons ─────────────────────────────────────────────────── */
const DATE_PRESETS = [
  { value: "all",       label: "All Time" },
  { value: "today",     label: "Today" },
  { value: "thisWeek",  label: "This Week" },
  { value: "thisMonth", label: "This Month" },
  { value: "thisYear",  label: "This Year" },
  { value: "custom",    label: "Custom" },
];

const DIRECTIONS = [
  { value: "all",   label: "Any" },
  { value: "long",  label: "Long" },
  { value: "short", label: "Short" },
];

const OUTCOMES = [
  { value: "all",       label: "Any" },
  { value: "win",       label: "Win" },
  { value: "loss",      label: "Loss" },
  { value: "breakeven", label: "Breakeven" },
  { value: "open",      label: "Open" },
];

const ASSET_CLASSES = [
  { value: "all",         label: "Any" },
  { value: "forex",       label: "Forex" },
  { value: "crypto",      label: "Crypto" },
  { value: "stocks",      label: "Stocks" },
  { value: "indices",     label: "Indices" },
  { value: "commodities", label: "Commodities" },
];

/* ── Sub-components ──────────────────────────────────────────────────────── */
function FilterLabel({ children }) {
  return <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{children}</p>;
}

function PillGroup({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium border transition-all",
            value === opt.value
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function FilterSelect({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={cn(
        "w-full h-8 px-2.5 rounded-lg border text-sm bg-card border-border",
        "text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50",
        "transition-colors"
      )}
    >
      <option value="all">{placeholder || "Any"}</option>
      {options.map(o => (
        <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
      ))}
    </select>
  );
}

/* ── Main FilterPanel ────────────────────────────────────────────────────── */
export default function FilterPanel({ onClose }) {
  const { filters, updateFilter, updateFilters, resetFilters, allTrades } = useTradeFilter();

  // Derive dynamic option lists from actual trade data
  const { strategies, accounts, symbols } = useMemo(() => {
    const strats  = [...new Set(allTrades.map(t => t.strategy).filter(Boolean))].sort();
    const accts   = [...new Set(allTrades.map(t => t.account).filter(Boolean))].sort();
    const syms    = [...new Set(allTrades.map(t => t.symbol).filter(Boolean))].sort();
    return { strategies: strats, accounts: accts, symbols: syms };
  }, [allTrades]);

  const handleReset = () => {
    resetFilters();
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-20 bg-black/10 backdrop-blur-[1px]" onClick={onClose} />

      {/* Panel */}
      <div className="sticky top-12 z-25 bg-card border-b border-border shadow-lg z-25 animate-in slide-in-from-top-2 duration-150">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">

            {/* ── Date Range ─────────────────────────────────────── */}
            <div className="sm:col-span-2 lg:col-span-2">
              <FilterLabel>Date Range</FilterLabel>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {DATE_PRESETS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => updateFilter("datePreset", p.value)}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-medium border transition-all",
                      filters.datePreset === p.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {filters.datePreset === "custom" && (
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={filters.dateFrom || ""}
                    onChange={e => updateFilter("dateFrom", e.target.value || null)}
                    className="h-8 text-xs bg-card border-border flex-1"
                  />
                  <span className="text-xs text-muted-foreground flex-shrink-0">to</span>
                  <Input
                    type="date"
                    value={filters.dateTo || ""}
                    onChange={e => updateFilter("dateTo", e.target.value || null)}
                    className="h-8 text-xs bg-card border-border flex-1"
                  />
                </div>
              )}
            </div>

            {/* ── Time Range ──────────────────────────────────────── */}
            <div>
              <FilterLabel>Time Range (UTC)</FilterLabel>
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={filters.timeFrom}
                  onChange={e => updateFilter("timeFrom", e.target.value)}
                  className="h-8 text-xs bg-card border-border flex-1"
                  placeholder="From"
                />
                <span className="text-xs text-muted-foreground flex-shrink-0">–</span>
                <Input
                  type="time"
                  value={filters.timeTo}
                  onChange={e => updateFilter("timeTo", e.target.value)}
                  className="h-8 text-xs bg-card border-border flex-1"
                  placeholder="To"
                />
              </div>
            </div>

            {/* ── Search ──────────────────────────────────────────── */}
            <div>
              <FilterLabel>Search</FilterLabel>
              <Input
                placeholder="Symbol, strategy, notes..."
                value={filters.search}
                onChange={e => updateFilter("search", e.target.value)}
                className="h-8 text-xs bg-card border-border"
              />
            </div>

            {/* ── Strategy ────────────────────────────────────────── */}
            <div>
              <FilterLabel>Strategy</FilterLabel>
              <FilterSelect
                value={filters.strategy}
                onChange={v => updateFilter("strategy", v)}
                options={strategies.map(s => ({ value: s, label: s }))}
                placeholder="All Strategies"
              />
            </div>

            {/* ── Account ─────────────────────────────────────────── */}
            <div>
              <FilterLabel>Account</FilterLabel>
              <FilterSelect
                value={filters.account}
                onChange={v => updateFilter("account", v)}
                options={accounts.map(a => ({ value: a, label: a }))}
                placeholder="All Accounts"
              />
            </div>

            {/* ── Symbol ──────────────────────────────────────────── */}
            <div>
              <FilterLabel>Symbol</FilterLabel>
              <FilterSelect
                value={filters.symbol}
                onChange={v => updateFilter("symbol", v)}
                options={symbols.map(s => ({ value: s, label: s }))}
                placeholder="All Symbols"
              />
            </div>

            {/* ── Asset Class ─────────────────────────────────────── */}
            <div>
              <FilterLabel>Asset Class</FilterLabel>
              <PillGroup
                options={ASSET_CLASSES}
                value={filters.assetClass}
                onChange={v => updateFilter("assetClass", v)}
              />
            </div>

            {/* ── Direction ───────────────────────────────────────── */}
            <div>
              <FilterLabel>Direction</FilterLabel>
              <PillGroup
                options={DIRECTIONS}
                value={filters.direction}
                onChange={v => updateFilter("direction", v)}
              />
            </div>

            {/* ── Outcome ─────────────────────────────────────────── */}
            <div>
              <FilterLabel>Outcome</FilterLabel>
              <PillGroup
                options={OUTCOMES}
                value={filters.outcome}
                onChange={v => updateFilter("outcome", v)}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="text-muted-foreground hover:text-foreground gap-1.5 h-8"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset all filters
            </Button>
            <Button size="sm" onClick={onClose} className="h-8">
              Apply
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
