// Instrument specifications for position sizing in LOTS.
//
// A forex position is sized in lots, not units: 1.00 standard lot is 100,000
// units of the base currency, so P&L is
//
//   price move × lots × contract size × (quote → account currency rate)
//
// This file is the one place that knows what a symbol *is* — its contract
// size, pip size, and which currencies it is priced in — so trade-calc.ts,
// the log-trade preview and the risk calculator can never disagree about what
// "1 lot" of EURUSD or XAUUSD means. All of it is pure and dependency-free so
// the same code runs in the browser preview and in the server functions that
// persist the numbers.
//
// Scope, deliberately: majors/minors/exotics (any pair of the currencies
// below, 100,000 contract), gold and silver (XAU 100 oz, XAG 5,000 oz — the
// common broker convention; some brokers differ), and crypto/anything else,
// which stays sized in plain units as before. Indices and other CFDs vary too
// much between brokers to guess, so they are left as "units" rather than
// silently sized wrong.

export type InstrumentKind = "forex" | "metal" | "crypto" | "other";
export type SizeUnit = "lots" | "units";

export interface InstrumentSpec {
  /** Upper-cased symbol with separators and broker suffixes removed, e.g. "EURUSD". */
  symbol: string;
  kind: InstrumentKind;
  /** ISO code of the base currency ("EUR", "XAU"), or null when unknown / not applicable. */
  base: string | null;
  /** ISO code of the quote (pricing) currency, or null when unknown / not applicable. */
  quote: string | null;
  /** Units of the base instrument in ONE lot (1.00). 1 for unit-sized instruments. */
  contractSize: number;
  /** Price increment that counts as one "pip" for this instrument; null for unit-sized ones. */
  pipSize: number | null;
  sizeUnit: SizeUnit;
}

/** The smallest lot increment brokers accept (0.01 = a "micro" lot). */
export const LOT_STEP = 0.01;

const FOREX_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD",
  "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "TRY", "ZAR", "MXN",
  "SGD", "HKD", "CNH", "CNY", "ILS", "THB", "RON", "CZK",
]);

const CRYPTO_PREFIX = /^(BTC|ETH|SOL|XRP|BNB|ADA|DOGE|LTC|LINK|AVAX|MATIC|DOT)/;

/** Common symbol variants only ("EUR/USD", "eurusd.m", "EURUSD_i", "EURUSDpro") → "EURUSD…" letters only. */
function cleanSymbol(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "");
}

const UNIT_SPEC = (symbol: string, kind: InstrumentKind): InstrumentSpec => ({
  symbol,
  kind,
  base: null,
  quote: null,
  contractSize: 1,
  pipSize: null,
  sizeUnit: "units",
});

export function getInstrumentSpec(rawSymbol: string): InstrumentSpec {
  const cleaned = cleanSymbol(rawSymbol);

  if (CRYPTO_PREFIX.test(cleaned)) return UNIT_SPEC(cleaned, "crypto");

  // Metals: XAU/XAG against a currency, e.g. XAUUSD, XAGUSD.
  const metal = /^(XAU|XAG)([A-Z]{3})/.exec(cleaned);
  if (metal && FOREX_CURRENCIES.has(metal[2]!)) {
    const isGold = metal[1] === "XAU";
    return {
      symbol: cleaned.slice(0, 6),
      kind: "metal",
      base: metal[1]!,
      quote: metal[2]!,
      contractSize: isGold ? 100 : 5000,
      // Gold: 1 pip = 0.10 (so $10/lot/pip); silver: 1 pip = 0.01 (so $50/lot/pip).
      pipSize: isGold ? 0.1 : 0.01,
      sizeUnit: "lots",
    };
  }

  // Forex: two known ISO currency codes back to back. Anything after the
  // sixth letter is a broker suffix and is ignored.
  if (cleaned.length >= 6) {
    const base = cleaned.slice(0, 3);
    const quote = cleaned.slice(3, 6);
    if (base !== quote && FOREX_CURRENCIES.has(base) && FOREX_CURRENCIES.has(quote)) {
      return {
        symbol: `${base}${quote}`,
        kind: "forex",
        base,
        quote,
        contractSize: 100_000,
        pipSize: quote === "JPY" ? 0.01 : 0.0001,
        sizeUnit: "lots",
      };
    }
  }

  return UNIT_SPEC(cleaned || rawSymbol.toUpperCase(), "other");
}

/**
 * True when P&L on this instrument can't be turned into the account currency
 * from the trade's own prices alone — i.e. it's a cross (EURGBP, GBPJPY…)
 * relative to the account, so the person has to supply the rate.
 */
export function needsQuoteRate(spec: InstrumentSpec, accountCurrency: string): boolean {
  if (spec.sizeUnit !== "lots" || !spec.quote) return false;
  const account = accountCurrency.toUpperCase();
  return spec.quote !== account && spec.base !== account;
}

/**
 * Account-currency value of one unit of the quote currency, at `price`.
 *   - quoted in the account currency (EURUSD on a USD account): 1
 *   - account currency is the base (USDJPY, USDCAD on a USD account): 1 / price
 *   - anything else: the explicit `quoteRate`, or null if it wasn't given
 */
export function quoteToAccountRate(params: {
  spec: InstrumentSpec;
  accountCurrency: string;
  price: number;
  quoteRate?: number | null | undefined;
}): number | null {
  const { spec, price, quoteRate } = params;
  const account = params.accountCurrency.toUpperCase();
  if (spec.sizeUnit !== "lots" || !spec.quote) return 1;
  if (spec.quote === account) return 1;
  if (spec.base === account) return price > 0 ? 1 / price : null;
  return quoteRate != null && quoteRate > 0 ? quoteRate : null;
}

/** User-facing wording for the "size" of a trade in this instrument. */
export function sizeLabel(spec: InstrumentSpec): { noun: string; unit: string; placeholder: string } {
  return spec.sizeUnit === "lots"
    ? { noun: "Position size (lots)", unit: "lots", placeholder: "0.50" }
    : { noun: "Position size (units)", unit: "units", placeholder: "1" };
}

/** Human message for a cross pair where the rate is missing. */
export function missingQuoteRateMessage(spec: InstrumentSpec, accountCurrency: string): string {
  return `${spec.symbol} is priced in ${spec.quote}, not ${accountCurrency.toUpperCase()}. Enter the ${accountCurrency.toUpperCase()} value of 1 ${spec.quote} so P&L and risk can be converted.`;
}

// ---------------------------------------------------------------------------
// Sizing context: what trade-calc needs to turn "price move × lots" into money
// ---------------------------------------------------------------------------

export interface SizingContext {
  spec: InstrumentSpec;
  accountCurrency: string;
  /** Units of the instrument in one lot (1 for unit-sized instruments). */
  contractSize: number;
  /** Account-currency value of ONE quote-currency unit when the instrument trades at `price`. */
  rateAt: (price: number) => number;
}

/**
 * Builds the context for a symbol on an account. Throws a user-readable Error
 * when the symbol is a cross that needs a conversion rate and none was given —
 * that message is surfaced as-is in the UI, so it says what to enter.
 */
export function buildSizingContext(params: {
  symbol: string;
  accountCurrency: string;
  quoteRate?: number | null | undefined;
}): SizingContext {
  const spec = getInstrumentSpec(params.symbol);
  const accountCurrency = (params.accountCurrency || "USD").toUpperCase();
  if (needsQuoteRate(spec, accountCurrency) && !(params.quoteRate != null && params.quoteRate > 0)) {
    throw new Error(missingQuoteRateMessage(spec, accountCurrency));
  }
  return {
    spec,
    accountCurrency,
    contractSize: spec.contractSize,
    rateAt: (price) =>
      quoteToAccountRate({ spec, accountCurrency, price, quoteRate: params.quoteRate }) ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Legacy (calculation v1) trades were entered as raw units, not lots
// ---------------------------------------------------------------------------

/** Below this a v1 forex quantity is assumed to already be lots (nobody trades 1,000 lots). */
const LEGACY_UNITS_MIN_FOREX = 1000;
const LEGACY_UNITS_MIN_OTHER_LOT_INSTRUMENT = 100;

/** True when a stored quantity is a pre-lots "units" figure for an instrument that is now sized in lots. */
export function isLegacyUnitQuantity(params: { symbol: string; quantity: number; calculationVersion: string }): boolean {
  if (params.calculationVersion !== "v1") return false;
  const spec = getInstrumentSpec(params.symbol);
  if (spec.sizeUnit !== "lots") return false;
  return params.quantity >= (spec.kind === "forex" ? LEGACY_UNITS_MIN_FOREX : LEGACY_UNITS_MIN_OTHER_LOT_INSTRUMENT);
}

/** The trade's size as it should be displayed/edited: lots for lot instruments (converting legacy units), plain units otherwise. */
export function displaySize(trade: { symbol: string; quantity: number; calculation_version: string }): {
  value: number;
  unit: SizeUnit;
} {
  const spec = getInstrumentSpec(trade.symbol);
  if (spec.sizeUnit === "units") return { value: trade.quantity, unit: "units" };
  const legacy = isLegacyUnitQuantity({
    symbol: trade.symbol,
    quantity: trade.quantity,
    calculationVersion: trade.calculation_version,
  });
  return { value: legacy ? trade.quantity / spec.contractSize : trade.quantity, unit: "lots" };
}

/** "0.50 lots" / "1.2 units" — lots always show at least 2 decimals, the way platforms do. */
export function formatSize(size: { value: number; unit: SizeUnit }): string {
  if (size.unit === "lots") {
    return `${size.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })} ${size.value === 1 ? "lot" : "lots"}`;
  }
  return `${size.value.toLocaleString(undefined, { maximumFractionDigits: 8 })} units`;
}

// ---------------------------------------------------------------------------
// Pips
// ---------------------------------------------------------------------------

/** Distance between two prices in pips, or null for unit-sized instruments. */
export function priceToPips(spec: InstrumentSpec, distance: number): number | null {
  return spec.pipSize ? distance / spec.pipSize : null;
}

/** Account-currency value of one pip on ONE lot, at `price`. */
export function pipValuePerLot(ctx: SizingContext, price: number): number | null {
  if (!ctx.spec.pipSize) return null;
  return ctx.spec.pipSize * ctx.contractSize * ctx.rateAt(price);
}
