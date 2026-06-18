import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Wallet, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTradeFilter } from "@/lib/TradeFilterContext";
import FilterPanel from "./FilterPanel";

export default function TopBar() {
  const {
    accounts, activeAccount, setActiveAccount,
    hasActiveFilters, resetFilters, filters,
  } = useTradeFilter();

  const [acctOpen, setAcctOpen]     = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const acctRef = useRef(null);

  // Close account dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (acctRef.current && !acctRef.current.contains(e.target)) setAcctOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activeFiltersCount = Object.entries(filters).filter(([k, v]) => {
    const defaults = { datePreset: "all", dateFrom: null, dateTo: null,
      timeFrom: "", timeTo: "", strategy: "all", account: "all",
      symbol: "all", direction: "all", outcome: "all", assetClass: "all", search: "" };
    return v !== defaults[k] && v !== "" && v !== null;
  }).length;

  return (
    <>
      <div className="h-12 border-b border-border bg-background/80 backdrop-blur-sm flex items-center px-4 md:px-6 gap-3 sticky top-0 z-30">
        {/* Account switcher */}
        <div className="relative" ref={acctRef}>
          <button
            onClick={() => setAcctOpen(o => !o)}
            className={cn(
              "flex items-center gap-2 px-3 h-8 rounded-lg border text-sm font-medium transition-all",
              "bg-card border-border hover:border-primary/50 hover:bg-secondary/50",
              acctOpen && "border-primary/50 bg-secondary/50"
            )}
          >
            <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="max-w-[140px] truncate">
              {activeAccount ? activeAccount.name : "All Accounts"}
            </span>
            <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", acctOpen && "rotate-180")} />
          </button>

          {acctOpen && (
            <div className="absolute top-10 left-0 z-50 min-w-[200px] bg-card border border-border rounded-xl shadow-xl py-1.5 overflow-hidden">
              {/* All Accounts option */}
              <button
                onClick={() => { setActiveAccount(null); setAcctOpen(false); }}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors hover:bg-secondary/60",
                  !activeAccount && "text-primary font-medium bg-primary/5"
                )}
              >
                <div className={cn(
                  "w-2 h-2 rounded-full flex-shrink-0",
                  !activeAccount ? "bg-primary" : "bg-muted-foreground/30"
                )} />
                All Accounts
              </button>

              {accounts.length > 0 && (
                <div className="my-1 border-t border-border/50" />
              )}

              {accounts.map(acct => (
                <button
                  key={acct.id}
                  onClick={() => { setActiveAccount(acct); setAcctOpen(false); }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors hover:bg-secondary/60",
                    activeAccount?.id === acct.id && "text-primary font-medium bg-primary/5"
                  )}
                >
                  <div className={cn(
                    "w-2 h-2 rounded-full flex-shrink-0",
                    activeAccount?.id === acct.id ? "bg-primary" : "bg-muted-foreground/30"
                  )} />
                  <div className="min-w-0">
                    <div className="truncate">{acct.name}</div>
                    {acct.starting_balance && (
                      <div className="text-[11px] text-muted-foreground font-mono">
                        ${Number(acct.starting_balance).toLocaleString()} starting
                      </div>
                    )}
                  </div>
                </button>
              ))}

              {accounts.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">No accounts yet</p>
              )}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-border" />

        {/* Filters button */}
        <button
          onClick={() => setFilterOpen(o => !o)}
          className={cn(
            "flex items-center gap-2 px-3 h-8 rounded-lg border text-sm font-medium transition-all",
            hasActiveFilters
              ? "bg-primary/10 border-primary/40 text-primary hover:bg-primary/15"
              : "bg-card border-border hover:border-primary/50 hover:bg-secondary/50",
            filterOpen && !hasActiveFilters && "border-primary/50 bg-secondary/50"
          )}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>Filters</span>
          {activeFiltersCount > 0 && (
            <span className="flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
              {activeFiltersCount}
            </span>
          )}
        </button>

        {/* Active filter chips */}
        {hasActiveFilters && (
          <>
            <ActiveFilterChips />
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 px-2 h-7 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors ml-auto"
            >
              <X className="w-3 h-3" />
              Reset
            </button>
          </>
        )}
      </div>

      {/* Filter panel — slides down from topbar */}
      {filterOpen && (
        <FilterPanel onClose={() => setFilterOpen(false)} />
      )}
    </>
  );
}

/* ── Active filter chips ─────────────────────────────────────────────────── */
function ActiveFilterChips() {
  const { filters, updateFilter, updateFilters } = useTradeFilter();

  const chips = [];

  if (filters.datePreset !== "all") {
    const labels = { today: "Today", thisWeek: "This Week", thisMonth: "This Month", thisYear: "This Year", custom: "Custom Range" };
    chips.push({
      label: labels[filters.datePreset] || filters.datePreset,
      onRemove: () => updateFilters({ datePreset: "all", dateFrom: null, dateTo: null }),
    });
  }
  if (filters.timeFrom || filters.timeTo) {
    chips.push({
      label: `${filters.timeFrom || "00:00"} – ${filters.timeTo || "23:59"}`,
      onRemove: () => updateFilters({ timeFrom: "", timeTo: "" }),
    });
  }
  const dims = ["strategy", "account", "symbol", "direction", "outcome", "assetClass"];
  dims.forEach(k => {
    if (filters[k] && filters[k] !== "all") {
      chips.push({ label: filters[k], onRemove: () => updateFilter(k, "all") });
    }
  });
  if (filters.search) {
    chips.push({ label: `"${filters.search}"`, onRemove: () => updateFilter("search", "") });
  }

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto flex-1 min-w-0">
      {chips.map((chip, i) => (
        <span
          key={i}
          className="flex items-center gap-1 px-2 h-6 rounded-full bg-primary/10 border border-primary/25 text-primary text-[11px] font-medium whitespace-nowrap flex-shrink-0"
        >
          {chip.label}
          <button onClick={chip.onRemove} className="hover:text-primary/60 transition-colors ml-0.5">
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}
    </div>
  );
}
