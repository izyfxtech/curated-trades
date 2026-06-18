// Generic PnL Engine — works for all asset classes
// To add a new instrument, just add it to INSTRUMENTS below.

export const INSTRUMENTS = {
  // Forex majors/minors — 1 lot = 100,000 units, PnL in quote currency
  EURUSD: { type: "forex", multiplier: 100000, pipSize: 0.0001, quoteCurrency: "USD" },
  GBPUSD: { type: "forex", multiplier: 100000, pipSize: 0.0001, quoteCurrency: "USD" },
  AUDUSD: { type: "forex", multiplier: 100000, pipSize: 0.0001, quoteCurrency: "USD" },
  NZDUSD: { type: "forex", multiplier: 100000, pipSize: 0.0001, quoteCurrency: "USD" },
  USDCAD: { type: "forex", multiplier: 100000, pipSize: 0.0001, quoteCurrency: "CAD" },
  USDCHF: { type: "forex", multiplier: 100000, pipSize: 0.0001, quoteCurrency: "CHF" },
  USDJPY: { type: "forex", multiplier: 100000, pipSize: 0.01,   quoteCurrency: "JPY" },
  GBPJPY: { type: "forex", multiplier: 100000, pipSize: 0.01,   quoteCurrency: "JPY" },
  EURJPY: { type: "forex", multiplier: 100000, pipSize: 0.01,   quoteCurrency: "JPY" },
  EURGBP: { type: "forex", multiplier: 100000, pipSize: 0.0001, quoteCurrency: "GBP" },

  // Metals — 1 lot = 100 oz for gold, 5000 oz for silver
  XAUUSD: { type: "metal", multiplier: 100,   pipSize: 0.01, quoteCurrency: "USD" },
  XAGUSD: { type: "metal", multiplier: 5000,  pipSize: 0.001, quoteCurrency: "USD" },

  // Indices (CFD) — 1 contract = 1 point
  NAS100: { type: "index", multiplier: 1, pipSize: 0.25, quoteCurrency: "USD" },
  US30:   { type: "index", multiplier: 1, pipSize: 1,    quoteCurrency: "USD" },
  SPX500: { type: "index", multiplier: 1, pipSize: 0.25, quoteCurrency: "USD" },
  UK100:  { type: "index", multiplier: 1, pipSize: 0.5,  quoteCurrency: "GBP" },
  GER40:  { type: "index", multiplier: 1, pipSize: 0.5,  quoteCurrency: "EUR" },

  // Commodities
  USOIL:  { type: "commodity", multiplier: 1000, pipSize: 0.01, quoteCurrency: "USD" },
  UKOIL:  { type: "commodity", multiplier: 1000, pipSize: 0.01, quoteCurrency: "USD" },

  // Crypto — 1 unit = 1 coin
  BTCUSD: { type: "crypto", multiplier: 1, pipSize: 1,    quoteCurrency: "USD" },
  ETHUSD: { type: "crypto", multiplier: 1, pipSize: 0.01, quoteCurrency: "USD" },
  SOLUSD: { type: "crypto", multiplier: 1, pipSize: 0.01, quoteCurrency: "USD" },
};

/**
 * Get instrument spec, falling back to a generic 1:1 spec if unknown.
 */
export function getInstrumentSpec(symbol) {
  if (!symbol) return { type: "generic", multiplier: 1, pipSize: 0.01, quoteCurrency: "USD" };
  const upper = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return INSTRUMENTS[upper] || { type: "stock", multiplier: 1, pipSize: 0.01, quoteCurrency: "USD" };
}

/**
 * Universal PnL calculation.
 * Works for: forex, metals, indices, crypto, stocks, futures, commodities.
 *
 * @param {object} params
 * @param {string} params.symbol
 * @param {"long"|"short"} params.direction
 * @param {number} params.entryPrice
 * @param {number} params.exitPrice
 * @param {number} params.quantity  — lots / shares / contracts / units
 * @param {number} [params.commission] — flat commission amount
 * @param {number} [params.swap]
 * @returns {{ grossPnl: number, netPnl: number, priceDelta: number }}
 */
export function calculatePnl({ symbol, direction, entryPrice, exitPrice, quantity, commission = 0, swap = 0 }) {
  if (entryPrice == null || exitPrice == null || quantity == null) return null;

  const spec = getInstrumentSpec(symbol);
  const priceDelta = direction === "long"
    ? exitPrice - entryPrice
    : entryPrice - exitPrice;

  const grossPnl = priceDelta * quantity * spec.multiplier;
  const netPnl = grossPnl - commission - swap;

  return { grossPnl, netPnl, priceDelta, spec };
}

/**
 * Returns the quantity label for a given asset type.
 */
export function getQuantityLabel(symbol) {
  const spec = getInstrumentSpec(symbol);
  switch (spec.type) {
    case "forex":
    case "metal":
    case "commodity":
      return "Lots";
    case "stock":
      return "Shares";
    case "index":
    case "crypto":
      return "Quantity";
    default:
      return "Quantity";
  }
}
