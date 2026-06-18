/**
 * TradeFilterContext
 *
 * Single source of truth for:
 *   - activeAccount  : the currently selected Account object (or null = "All Accounts")
 *   - filters        : all filter values
 *   - filteredTrades : memoised result of applying filters to the raw trade list
 *
 * All pages read `filteredTrades` from this context instead of raw `trades`.
 * Adding a new filter dimension = one extra field in DEFAULT_FILTERS + one
 * condition in useFilteredTrades (lib/useFilteredTrades.js). Zero other changes.
 */

import React, {
  createContext, useContext, useState, useMemo, useCallback,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { entities } from "@/api/entities";
import { applyFilters } from "@/lib/useFilteredTrades";

/* ─── Default filter state ──────────────────────────────────────────────── */
export const DEFAULT_FILTERS = {
  // Date
  datePreset: "all",        // "today"|"thisWeek"|"thisMonth"|"thisYear"|"custom"|"all"
  dateFrom: null,           // ISO string, only used when preset === "custom"
  dateTo: null,

  // Time-of-day
  timeFrom: "",             // "HH:mm" 24h, empty = no filter
  timeTo: "",

  // Dimensions
  strategy: "all",
  account: "all",           // account name string, or "all"
  symbol: "all",
  direction: "all",         // "long" | "short" | "all"
  outcome: "all",           // "win" | "loss" | "breakeven" | "open" | "all"
  assetClass: "all",        // "forex" | "crypto" | "stocks" | "indices" | "commodities" | "all"

  // Text search (kept here so it travels with the rest of the filters)
  search: "",
};

/* ─── Context ────────────────────────────────────────────────────────────── */
const TradeFilterContext = createContext(null);

export function TradeFilterProvider({ children }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [activeAccount, setActiveAccount] = useState(null); // Account object | null

  /* Raw trades — fetched once, shared across the whole app via React Query cache */
  const { data: allTrades = [], isLoading: tradesLoading } = useQuery({
    queryKey: ["trades"],
    queryFn: () => entities.Trade.list("-close_time", 500),
  });

  /* Accounts — for the switcher dropdown */
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => entities.Account.list("-created_at", 100),
  });

  /* Apply all filters, scoped to activeAccount when one is selected */
  const filteredTrades = useMemo(() => {
    // First scope to active account if one is selected
    const accountScoped = activeAccount
      ? allTrades.filter(t => t.account === activeAccount.name)
      : allTrades;

    return applyFilters(accountScoped, filters);
  }, [allTrades, activeAccount, filters]);

  /* Starting balance for charts — from the active account or 0 */
  const startingBalance = useMemo(() => {
    if (activeAccount?.starting_balance) return Number(activeAccount.starting_balance);
    // If "All Accounts": sum up all account starting balances
    if (!activeAccount && accounts.length) {
      return accounts.reduce((s, a) => s + Number(a.starting_balance || 0), 0);
    }
    return 0;
  }, [activeAccount, accounts]);

  const updateFilter = useCallback((key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const updateFilters = useCallback((partial) => {
    setFilters(prev => ({ ...prev, ...partial }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const hasActiveFilters = useMemo(() => {
    return Object.entries(filters).some(([k, v]) => {
      const def = DEFAULT_FILTERS[k];
      return v !== def && v !== "" && v !== null;
    });
  }, [filters]);

  return (
    <TradeFilterContext.Provider value={{
      // Data
      allTrades,
      filteredTrades,
      tradesLoading,
      accounts,
      // Account switcher
      activeAccount,
      setActiveAccount,
      startingBalance,
      // Filters
      filters,
      updateFilter,
      updateFilters,
      resetFilters,
      hasActiveFilters,
    }}>
      {children}
    </TradeFilterContext.Provider>
  );
}

export function useTradeFilter() {
  const ctx = useContext(TradeFilterContext);
  if (!ctx) throw new Error("useTradeFilter must be used inside <TradeFilterProvider>");
  return ctx;
}
