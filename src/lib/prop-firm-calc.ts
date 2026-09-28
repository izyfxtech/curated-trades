// Prop-firm compliance calculations (Phase 2.4). Pure and DB-agnostic, same
// reasoning as trade-calc.ts: one calculation layer that both the server
// function and (if ever needed) a test file can call, so there is exactly
// one place that knows what "daily loss used" or "drawdown remaining" means.
//
// Deliberate limitation, stated once here rather than scattered in comments
// elsewhere: this app has no live price feed, so every balance figure below
// is the *realized* account balance (starting_equity + net P&L of trades
// that have actually closed). There is no way to know true floating
// mark-to-market equity on trades that are still open, so an open position
// can silently be closer to breaching a daily-loss or drawdown rule than
// this dashboard shows. The compliance dashboard says this explicitly
// rather than implying a precision the app doesn't have.
import Decimal from "decimal.js";

export type ComplianceBasis = "starting_balance" | "current_balance" | "high_water_mark";

export interface ComplianceRuleInput {
  timezone: string;
  calculationBasis: ComplianceBasis;
  maxDailyLossPercent: number;
  maxTotalDrawdownPercent: number;
  profitTargetPercent: number | null;
  minTradingDays: number | null;
  maxTradingDays: number | null;
  consistencyPercent: number | null;
}

export interface ClosedTradeForCompliance {
  id: string;
  closedAt: string;
  netPnl: number;
}

export type RuleEventType =
  | "daily_loss_warning"
  | "daily_loss_breach"
  | "drawdown_warning"
  | "drawdown_breach"
  | "profit_target_reached"
  | "consistency_flag"
  | "min_days_met"
  | "max_days_exceeded";

export interface DetectedRuleEvent {
  eventType: RuleEventType;
  severity: "info" | "warning" | "breach";
  message: string;
  occurredOn: string;
}

export interface ComplianceStatus {
  basis: ComplianceBasis;
  startingEquity: number;
  currentBalance: number;
  peakBalance: number;
  today: {
    dateKey: string;
    pnl: number;
    lossUsed: number;
    lossLimit: number;
    lossUsedPercent: number;
  };
  drawdown: {
    used: number;
    limit: number;
    usedPercent: number;
  };
  profitTarget: {
    targetPercent: number;
    targetAmount: number;
    progressAmount: number;
    progressPercent: number;
  } | null;
  tradingDays: {
    count: number;
    min: number | null;
    max: number | null;
  };
  consistency: {
    percentLimit: number;
    bestDayShare: number;
    flagged: boolean;
  } | null;
  events: DetectedRuleEvent[];
}

const WARNING_THRESHOLD_PERCENT = 80;

/** YYYY-MM-DD for `iso` as observed in `timezone` (falls back to UTC for an invalid IANA name). */
export function getTradingDayKey(iso: string, timezone: string): string {
  const formatterOptions: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, ...formatterOptions }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", ...formatterOptions }).format(new Date(iso));
  }
}

export function computeComplianceStatus(
  rules: ComplianceRuleInput,
  startingEquity: number,
  closedTrades: ClosedTradeForCompliance[],
  now: Date = new Date(),
): ComplianceStatus {
  const sorted = [...closedTrades].sort((a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime());

  const balanceAtStartOfDay = new Map<string, Decimal>();
  const peakAtStartOfDay = new Map<string, Decimal>();
  const pnlByDay = new Map<string, Decimal>();

  let runningBalance = new Decimal(startingEquity);
  let runningPeak = new Decimal(startingEquity);
  let lastDateKey: string | null = null;

  for (const trade of sorted) {
    const dateKey = getTradingDayKey(trade.closedAt, rules.timezone);
    if (dateKey !== lastDateKey) {
      balanceAtStartOfDay.set(dateKey, runningBalance);
      peakAtStartOfDay.set(dateKey, runningPeak);
      lastDateKey = dateKey;
    }
    runningBalance = runningBalance.plus(trade.netPnl ?? 0);
    runningPeak = Decimal.max(runningPeak, runningBalance);
    pnlByDay.set(dateKey, (pnlByDay.get(dateKey) ?? new Decimal(0)).plus(trade.netPnl ?? 0));
  }

  const currentBalance = runningBalance;
  const peakBalance = runningPeak;
  const tradingDayKeys = [...pnlByDay.keys()].sort();
  const todayKey = getTradingDayKey(now.toISOString(), rules.timezone);

  const todayPnl = pnlByDay.get(todayKey) ?? new Decimal(0);
  const dailyLossBasisValue =
    rules.calculationBasis === "starting_balance"
      ? new Decimal(startingEquity)
      : rules.calculationBasis === "high_water_mark"
        ? (peakAtStartOfDay.get(todayKey) ?? peakBalance)
        : (balanceAtStartOfDay.get(todayKey) ?? currentBalance);
  const lossLimit = dailyLossBasisValue.mul(rules.maxDailyLossPercent).div(100);
  const lossUsed = Decimal.max(0, todayPnl.neg());
  const lossUsedPercent = lossLimit.gt(0) ? lossUsed.div(lossLimit).mul(100).toNumber() : 0;

  const drawdownBasisValue = rules.calculationBasis === "high_water_mark" ? peakBalance : new Decimal(startingEquity);
  const drawdownLimit = drawdownBasisValue.mul(rules.maxTotalDrawdownPercent).div(100);
  const drawdownUsed = Decimal.max(0, drawdownBasisValue.minus(currentBalance));
  const drawdownUsedPercent = drawdownLimit.gt(0) ? drawdownUsed.div(drawdownLimit).mul(100).toNumber() : 0;

  const profitTarget =
    rules.profitTargetPercent != null
      ? (() => {
          const targetAmount = new Decimal(startingEquity).mul(rules.profitTargetPercent!).div(100);
          const progressAmount = currentBalance.minus(startingEquity);
          return {
            targetPercent: rules.profitTargetPercent!,
            targetAmount: targetAmount.toNumber(),
            progressAmount: progressAmount.toNumber(),
            progressPercent: targetAmount.gt(0) ? progressAmount.div(targetAmount).mul(100).toNumber() : 0,
          };
        })()
      : null;

  let consistency: ComplianceStatus["consistency"] = null;
  if (rules.consistencyPercent != null && tradingDayKeys.length >= 2) {
    const profitableDays = tradingDayKeys.map((key) => pnlByDay.get(key) ?? new Decimal(0)).filter((v) => v.gt(0));
    const totalProfit = profitableDays.reduce((sum, v) => sum.plus(v), new Decimal(0));
    const bestDay = profitableDays.reduce((max, v) => Decimal.max(max, v), new Decimal(0));
    const bestDayShare = totalProfit.gt(0) ? bestDay.div(totalProfit).mul(100).toNumber() : 0;
    consistency = { percentLimit: rules.consistencyPercent, bestDayShare, flagged: bestDayShare > rules.consistencyPercent };
  }

  const events: DetectedRuleEvent[] = [];
  if (lossUsedPercent >= 100) {
    events.push({
      eventType: "daily_loss_breach",
      severity: "breach",
      message: `Today's realized loss reached ${lossUsedPercent.toFixed(0)}% of the daily loss limit.`,
      occurredOn: todayKey,
    });
  } else if (lossUsedPercent >= WARNING_THRESHOLD_PERCENT) {
    events.push({
      eventType: "daily_loss_warning",
      severity: "warning",
      message: `Today's realized loss reached ${lossUsedPercent.toFixed(0)}% of the daily loss limit.`,
      occurredOn: todayKey,
    });
  }
  if (drawdownUsedPercent >= 100) {
    events.push({
      eventType: "drawdown_breach",
      severity: "breach",
      message: `Total drawdown reached ${drawdownUsedPercent.toFixed(0)}% of the allowed maximum.`,
      occurredOn: todayKey,
    });
  } else if (drawdownUsedPercent >= WARNING_THRESHOLD_PERCENT) {
    events.push({
      eventType: "drawdown_warning",
      severity: "warning",
      message: `Total drawdown reached ${drawdownUsedPercent.toFixed(0)}% of the allowed maximum.`,
      occurredOn: todayKey,
    });
  }
  if (profitTarget && profitTarget.progressPercent >= 100) {
    events.push({
      eventType: "profit_target_reached",
      severity: "info",
      message: `Profit target reached (${profitTarget.progressPercent.toFixed(0)}% of target).`,
      occurredOn: todayKey,
    });
  }
  if (consistency?.flagged) {
    events.push({
      eventType: "consistency_flag",
      severity: "warning",
      message: `Best single day is ${consistency.bestDayShare.toFixed(0)}% of total profit, above the ${consistency.percentLimit}% consistency rule.`,
      occurredOn: todayKey,
    });
  }
  if (rules.minTradingDays != null && tradingDayKeys.length === rules.minTradingDays) {
    events.push({
      eventType: "min_days_met",
      severity: "info",
      message: `Minimum trading day requirement met (${rules.minTradingDays} days).`,
      occurredOn: todayKey,
    });
  }
  if (rules.maxTradingDays != null && tradingDayKeys.length > rules.maxTradingDays) {
    events.push({
      eventType: "max_days_exceeded",
      severity: "warning",
      message: `Trading day count (${tradingDayKeys.length}) has exceeded the maximum of ${rules.maxTradingDays}.`,
      occurredOn: todayKey,
    });
  }

  return {
    basis: rules.calculationBasis,
    startingEquity,
    currentBalance: currentBalance.toNumber(),
    peakBalance: peakBalance.toNumber(),
    today: {
      dateKey: todayKey,
      pnl: todayPnl.toNumber(),
      lossUsed: lossUsed.toNumber(),
      lossLimit: lossLimit.toNumber(),
      lossUsedPercent,
    },
    drawdown: { used: drawdownUsed.toNumber(), limit: drawdownLimit.toNumber(), usedPercent: drawdownUsedPercent },
    profitTarget,
    tradingDays: { count: tradingDayKeys.length, min: rules.minTradingDays, max: rules.maxTradingDays },
    consistency,
    events,
  };
}
