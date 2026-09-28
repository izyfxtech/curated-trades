// Single calculation layer for P&L, fees, R-multiple, expectancy, drawdown, and
// position sizing — per the shared technical foundation: manual, imported, and
// (eventually) synchronized trades must all produce identical results.
//
// All money/price/quantity math happens in Decimal and is only converted back
// to `number` at the very end of a calculation. Never do financial arithmetic
// in raw JS floats — 0.1 + 0.2 !== 0.3, and that error compounds across a
// journal with thousands of trades.
//
// Bump CALCULATION_VERSION whenever a formula changes, and stamp it onto the
// `trades.calculation_version` column so historical trades can be identified
// and (if needed) recomputed under the old formula rather than silently
// drifting.
import Decimal from "decimal.js";

export const CALCULATION_VERSION = "v1" as const;

export type Direction = "long" | "short";
export type TradeStatus = "open" | "closed" | "cancelled" | "incomplete";
export type CuratedLabel = "curated" | "impulse";
export type TradeOutcome = "win" | "loss" | "breakeven";
export type Market = "forex" | "crypto";

function toDecimal(value: number | string | Decimal): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

function signForDirection(direction: Direction): 1 | -1 {
  return direction === "long" ? 1 : -1;
}

// ---------------------------------------------------------------------------
// Single-trade calculation (supports partial exits via `exits`)
// ---------------------------------------------------------------------------

export interface ExitInput {
  exitPrice: number;
  quantity: number;
  fees?: number;
}

export interface TradeCalcInput {
  direction: Direction;
  entryPrice: number;
  quantity: number;
  entryFees?: number;
  spreadCost?: number;
  swapFunding?: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  /** One row per realized exit. Empty for a fully open trade. */
  exits: ExitInput[];
}

export interface TradeCalcResult {
  grossPnl: number | null;
  netPnl: number | null;
  filledQuantity: number;
  averageExitPrice: number | null;
  initialRisk: number | null;
  plannedRMultiple: number | null;
  realizedRMultiple: number | null;
  movePercent: number | null;
  outcome: TradeOutcome | null;
}

/**
 * Computes P&L and derived risk metrics for a trade, weighting across any
 * partial exits. Returns nulls for fields that aren't determinable yet
 * (e.g. an open trade with no exits has no realized P&L or outcome).
 */
export function calculateTrade(input: TradeCalcInput): TradeCalcResult {
  const entry = toDecimal(input.entryPrice);
  const sign = signForDirection(input.direction);
  const entryFees = toDecimal(input.entryFees ?? 0);
  const spread = toDecimal(input.spreadCost ?? 0);
  const swap = toDecimal(input.swapFunding ?? 0);

  const filledQuantity = input.exits.reduce((sum, exit) => sum.plus(exit.quantity), new Decimal(0));

  let grossPnl: Decimal | null = null;
  let netPnl: Decimal | null = null;
  let averageExitPrice: Decimal | null = null;

  if (input.exits.length > 0 && filledQuantity.greaterThan(0)) {
    let weightedExitSum = new Decimal(0);
    let grossSum = new Decimal(0);
    let exitFeesSum = new Decimal(0);

    for (const exit of input.exits) {
      const exitPrice = toDecimal(exit.exitPrice);
      const exitQty = toDecimal(exit.quantity);
      grossSum = grossSum.plus(exitPrice.minus(entry).times(sign).times(exitQty));
      weightedExitSum = weightedExitSum.plus(exitPrice.times(exitQty));
      exitFeesSum = exitFeesSum.plus(exit.fees ?? 0);
    }

    averageExitPrice = weightedExitSum.dividedBy(filledQuantity);
    grossPnl = grossSum;
    netPnl = grossSum.minus(entryFees).minus(exitFeesSum).minus(spread).minus(swap);
  }

  const stop = input.stopLoss != null ? toDecimal(input.stopLoss) : null;
  const target = input.takeProfit != null ? toDecimal(input.takeProfit) : null;
  const totalQuantity = toDecimal(input.quantity);
  const stopDistance = stop != null ? entry.minus(stop).abs() : null;

  const initialRisk = stopDistance != null ? stopDistance.times(totalQuantity) : null;

  const plannedRMultiple =
    stopDistance != null && target != null && !stopDistance.isZero()
      ? target.minus(entry).abs().dividedBy(stopDistance)
      : null;

  const realizedRMultiple =
    netPnl != null && initialRisk != null && !initialRisk.isZero()
      ? netPnl.dividedBy(initialRisk)
      : null;

  const movePercent =
    averageExitPrice != null && !entry.isZero()
      ? averageExitPrice.minus(entry).dividedBy(entry).times(sign).times(100)
      : null;

  const outcome: TradeOutcome | null =
    netPnl == null ? null : netPnl.isZero() ? "breakeven" : netPnl.isPositive() ? "win" : "loss";

  return {
    grossPnl: grossPnl?.toNumber() ?? null,
    netPnl: netPnl?.toNumber() ?? null,
    filledQuantity: filledQuantity.toNumber(),
    averageExitPrice: averageExitPrice?.toNumber() ?? null,
    initialRisk: initialRisk?.toNumber() ?? null,
    plannedRMultiple: plannedRMultiple?.toNumber() ?? null,
    realizedRMultiple: realizedRMultiple?.toNumber() ?? null,
    movePercent: movePercent?.toNumber() ?? null,
    outcome,
  };
}

/** Holding duration in whole seconds, or null while the trade is still open. */
export function calculateHoldingSeconds(openedAt: string, closedAt: string | null): number | null {
  if (!closedAt) return null;
  const start = new Date(openedAt).getTime();
  const end = new Date(closedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 1000);
}

export interface ExitPnlInput {
  direction: Direction;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  fees?: number;
}

/** P&L for a single exit fill, independent of the trade's other exits — used to stamp each trade_exits row. */
export function calculateExitPnl(input: ExitPnlInput): { grossPnl: number; netPnl: number } {
  const entry = toDecimal(input.entryPrice);
  const exit = toDecimal(input.exitPrice);
  const quantity = toDecimal(input.quantity);
  const sign = signForDirection(input.direction);
  const gross = exit.minus(entry).times(sign).times(quantity);
  const net = gross.minus(input.fees ?? 0);
  return { grossPnl: gross.toNumber(), netPnl: net.toNumber() };
}

// ---------------------------------------------------------------------------
// Position sizing / risk preview (Phase 1.5)
// ---------------------------------------------------------------------------

export interface RiskPreviewInput {
  equity: number;
  riskPercent: number;
  entryPrice: number;
  stopLoss: number;
}

export interface RiskPreviewResult {
  riskAmount: number;
  stopDistance: number;
  suggestedQuantity: number | null;
}

export function calculateRiskPreview(input: RiskPreviewInput): RiskPreviewResult {
  const equity = toDecimal(input.equity);
  const riskPercent = toDecimal(input.riskPercent);
  const entry = toDecimal(input.entryPrice);
  const stop = toDecimal(input.stopLoss);
  const riskAmount = equity.times(riskPercent).dividedBy(100);
  const stopDistance = entry.minus(stop).abs();
  const suggestedQuantity = stopDistance.isZero() ? null : riskAmount.dividedBy(stopDistance);

  return {
    riskAmount: riskAmount.toNumber(),
    stopDistance: stopDistance.toNumber(),
    suggestedQuantity: suggestedQuantity?.toNumber() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Aggregate analytics over a set of closed trades (Phase 1.4)
// ---------------------------------------------------------------------------

export interface ClosedTradeForAnalytics {
  id: string;
  netPnl: number;
  realizedRMultiple: number | null;
  curatedLabel: CuratedLabel;
  openedAt: string;
  closedAt: string | null;
}

export interface StreakInfo {
  type: "win" | "loss";
  count: number;
}

export interface AnalyticsSummary {
  tradeCount: number;
  netPnl: number;
  winRate: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  averageRMultiple: number | null;
  maxDrawdownPercent: number | null;
  /** Same drawdown as maxDrawdownPercent, in dollars — computed from the actual
   *  equity peak at the worst point, not reconstructed from the percentage
   *  (peak can exceed startingEquity after a profit run-up, so
   *  startingEquity * percent/100 would understate it). */
  maxDrawdownDollars: number | null;
  currentStreak: StreakInfo | null;
  hasEnoughDataForDrawdown: boolean;
}

/** Below this many closed trades, drawdown/streak stats are misleading — show "not enough data" instead. */
export const MIN_TRADES_FOR_DRAWDOWN = 5;

const emptySummary: AnalyticsSummary = {
  tradeCount: 0,
  netPnl: 0,
  winRate: null,
  averageWin: null,
  averageLoss: null,
  profitFactor: null,
  expectancy: null,
  averageRMultiple: null,
  maxDrawdownPercent: null,
  maxDrawdownDollars: null,
  currentStreak: null,
  hasEnoughDataForDrawdown: false,
};

export function summarizeClosedTrades(
  trades: ClosedTradeForAnalytics[],
  startingEquity: number,
): AnalyticsSummary {
  if (trades.length === 0) return emptySummary;

  let net = new Decimal(0);
  let grossWin = new Decimal(0);
  let grossLoss = new Decimal(0);
  let winCount = 0;
  let lossCount = 0;
  let rSum = new Decimal(0);
  let rCount = 0;

  for (const trade of trades) {
    const pnl = toDecimal(trade.netPnl);
    net = net.plus(pnl);
    if (pnl.isPositive()) {
      grossWin = grossWin.plus(pnl);
      winCount += 1;
    } else if (pnl.isNegative()) {
      grossLoss = grossLoss.plus(pnl.abs());
      lossCount += 1;
    }
    if (trade.realizedRMultiple != null) {
      rSum = rSum.plus(trade.realizedRMultiple);
      rCount += 1;
    }
  }

  const chronological = [...trades].sort(
    (a, b) =>
      new Date(a.closedAt ?? a.openedAt).getTime() - new Date(b.closedAt ?? b.openedAt).getTime(),
  );

  let running = new Decimal(startingEquity);
  let peak = running;
  let maxDrawdown = new Decimal(0);
  let maxDrawdownDollars = new Decimal(0);
  for (const trade of chronological) {
    running = running.plus(trade.netPnl);
    if (running.greaterThan(peak)) peak = running;
    if (peak.greaterThan(0)) {
      const drawdownDollars = peak.minus(running);
      const drawdown = drawdownDollars.dividedBy(peak).times(100);
      if (drawdown.greaterThan(maxDrawdown)) {
        maxDrawdown = drawdown;
        maxDrawdownDollars = drawdownDollars;
      }
    }
  }

  const recent = [...trades].sort(
    (a, b) =>
      new Date(b.closedAt ?? b.openedAt).getTime() - new Date(a.closedAt ?? a.openedAt).getTime(),
  );
  let streak: StreakInfo | null = null;
  for (const trade of recent) {
    const type: "win" | "loss" | null = trade.netPnl > 0 ? "win" : trade.netPnl < 0 ? "loss" : null;
    if (!type) break;
    if (!streak) {
      streak = { type, count: 1 };
    } else if (streak.type === type) {
      streak.count += 1;
    } else {
      break;
    }
  }

  const hasEnoughDataForDrawdown = trades.length >= MIN_TRADES_FOR_DRAWDOWN;

  return {
    tradeCount: trades.length,
    netPnl: net.toNumber(),
    winRate: winCount + lossCount > 0 ? Math.round((winCount / trades.length) * 100) : null,
    averageWin: winCount > 0 ? grossWin.dividedBy(winCount).toNumber() : null,
    averageLoss: lossCount > 0 ? grossLoss.dividedBy(lossCount).toNumber() : null,
    profitFactor: grossLoss.greaterThan(0)
      ? grossWin.dividedBy(grossLoss).toNumber()
      : grossWin.greaterThan(0)
        ? Infinity
        : null,
    expectancy: net.dividedBy(trades.length).toNumber(),
    averageRMultiple: rCount > 0 ? rSum.dividedBy(rCount).toNumber() : null,
    maxDrawdownPercent: hasEnoughDataForDrawdown ? maxDrawdown.toNumber() : null,
    maxDrawdownDollars: hasEnoughDataForDrawdown ? maxDrawdownDollars.toNumber() : null,
    currentStreak: streak,
    hasEnoughDataForDrawdown,
  };
}

/** Detects the market from a symbol until the user picks explicitly in the UI. */
export function guessMarket(symbol: string): Market {
  return /^(BTC|ETH|SOL|XRP|BNB|ADA|DOGE|LTC|LINK|AVAX|MATIC|DOT)/i.test(symbol)
    ? "crypto"
    : "forex";
}

/** UTC-hour session heuristic used only as a fallback until portfolio timezone-aware session derivation lands. */
export function detectSessionFallback(iso: string): "London" | "New York" | "Asia" {
  const hour = new Date(iso).getUTCHours();
  if (hour >= 7 && hour < 12) return "London";
  if (hour >= 12 && hour < 21) return "New York";
  return "Asia";
}
