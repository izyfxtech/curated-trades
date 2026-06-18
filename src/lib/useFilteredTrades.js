/**
 * useFilteredTrades / applyFilters
 *
 * Pure filter logic — no React, no UI.
 * Adding a new filter: add a condition block below. Nothing else changes.
 */

import { startOfDay, endOfDay, startOfWeek, endOfWeek,
         startOfMonth, endOfMonth, startOfYear, endOfYear,
         parseISO, isWithinInterval } from "date-fns";

/* ─── Date preset helpers ────────────────────────────────────────────────── */
function getPresetRange(preset) {
  const now = new Date();
  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "thisWeek":
      return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
    case "thisMonth":
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case "thisYear":
      return { from: startOfYear(now), to: endOfYear(now) };
    default:
      return null;
  }
}

/* ─── Asset class detection ──────────────────────────────────────────────── */
const CRYPTO_SYMBOLS  = /BTC|ETH|XRP|SOL|BNB|DOGE|ADA|USDT|USD[CT]/i;
const INDICES_SYMBOLS = /US30|US100|SPX|NAS|DAX|FTSE|N225|GER|UK|JP|AU200|HK50/i;
const COMMODITY_SYMS  = /XAU|XAG|GOLD|SILVER|OIL|WTI|BRENT|NGAS|COPPER/i;
// Forex: 6-char currency pairs like EURUSD, GBPJPY, etc.
const FOREX_RE        = /^[A-Z]{6}$/;

function detectAssetClass(symbol) {
  if (!symbol) return "other";
  const s = symbol.toUpperCase().replace("/", "");
  if (CRYPTO_SYMBOLS.test(s))  return "crypto";
  if (INDICES_SYMBOLS.test(s)) return "indices";
  if (COMMODITY_SYMS.test(s))  return "commodities";
  if (FOREX_RE.test(s))        return "forex";
  return "stocks"; // fallback
}

/* ─── Main filter engine ─────────────────────────────────────────────────── */
export function applyFilters(trades, filters) {
  if (!trades?.length) return [];

  return trades.filter(trade => {
    const tradeDate = new Date(trade.close_time || trade.created_at);

    /* ── Date range ──────────────────────────────────────────────────── */
    if (filters.datePreset && filters.datePreset !== "all") {
      if (filters.datePreset === "custom") {
        if (filters.dateFrom || filters.dateTo) {
          const from = filters.dateFrom ? startOfDay(parseISO(filters.dateFrom)) : new Date(0);
          const to   = filters.dateTo   ? endOfDay(parseISO(filters.dateTo))     : new Date(8640000000000000);
          if (!isWithinInterval(tradeDate, { start: from, end: to })) return false;
        }
      } else {
        const range = getPresetRange(filters.datePreset);
        if (range && !isWithinInterval(tradeDate, { start: range.from, end: range.to })) return false;
      }
    }

    /* ── Time of day ─────────────────────────────────────────────────── */
    if (filters.timeFrom || filters.timeTo) {
      const hhmm = (d) => d.getHours() * 60 + d.getMinutes();
      const tradeMins = hhmm(tradeDate);
      if (filters.timeFrom) {
        const [h, m] = filters.timeFrom.split(":").map(Number);
        if (tradeMins < h * 60 + m) return false;
      }
      if (filters.timeTo) {
        const [h, m] = filters.timeTo.split(":").map(Number);
        if (tradeMins > h * 60 + m) return false;
      }
    }

    /* ── Strategy ────────────────────────────────────────────────────── */
    if (filters.strategy && filters.strategy !== "all") {
      if (trade.strategy !== filters.strategy) return false;
    }

    /* ── Account ─────────────────────────────────────────────────────── */
    if (filters.account && filters.account !== "all") {
      if (trade.account !== filters.account) return false;
    }

    /* ── Symbol ──────────────────────────────────────────────────────── */
    if (filters.symbol && filters.symbol !== "all") {
      if (trade.symbol !== filters.symbol) return false;
    }

    /* ── Direction ───────────────────────────────────────────────────── */
    if (filters.direction && filters.direction !== "all") {
      const dir = (trade.direction || trade.trade_type || "").toLowerCase();
      if (dir !== filters.direction) return false;
    }

    /* ── Outcome ─────────────────────────────────────────────────────── */
    if (filters.outcome && filters.outcome !== "all") {
      if (filters.outcome === "open") {
        if (trade.close_time || trade.exit_price) return false;
      } else {
        if (trade.outcome !== filters.outcome) return false;
      }
    }

    /* ── Asset class ─────────────────────────────────────────────────── */
    if (filters.assetClass && filters.assetClass !== "all") {
      if (detectAssetClass(trade.symbol) !== filters.assetClass) return false;
    }

    /* ── Text search ─────────────────────────────────────────────────── */
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const haystack = [trade.symbol, trade.strategy, trade.account, trade.notes]
        .filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });
}
