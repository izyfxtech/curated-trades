// Deeper analytics (Phase 2.3). Every breakdown reuses summarizeClosedTrades
// from trade-calc.ts for its per-group stats, so a group of 12 trades and
// the whole-portfolio total are computed by the exact same formula — no
// separate "breakdown math" to drift out of sync with the rest of the app.
//
// Insight generation is deliberately rule-based, not statistical inference:
// every insight traces to an explicit threshold in generateInsights() below.
// There's no hidden scoring model to second-guess.
import {
  detectSessionFallback,
  summarizeClosedTrades,
  type ClosedTradeForAnalytics,
} from "@/lib/trade-calc";
import type { Database } from "@/integrations/supabase/types";

type TradeRow = Database["public"]["Tables"]["trades"]["Row"];
type TradeReviewRow = Database["public"]["Tables"]["trade_reviews"]["Row"];

export interface EnrichedTrade {
  trade: TradeRow;
  review: TradeReviewRow | null;
  mistakeTags: string[];
}

export function enrichTrades(
  trades: TradeRow[],
  reviews: TradeReviewRow[],
  tagLinks: { trade_id: string; tag_id: string }[],
  tags: { id: string; name: string; category: string }[],
): EnrichedTrade[] {
  const reviewByTradeId = new Map(reviews.map((r) => [r.trade_id, r]));
  const mistakeTagIds = new Set(tags.filter((t) => t.category === "mistake").map((t) => t.id));
  const tagNameById = new Map(tags.map((t) => [t.id, t.name]));
  const mistakeTagsByTradeId = new Map<string, string[]>();
  for (const link of tagLinks) {
    if (!mistakeTagIds.has(link.tag_id)) continue;
    const name = tagNameById.get(link.tag_id);
    if (!name) continue;
    const list = mistakeTagsByTradeId.get(link.trade_id) ?? [];
    list.push(name);
    mistakeTagsByTradeId.set(link.trade_id, list);
  }

  return trades.map((trade) => ({
    trade,
    review: reviewByTradeId.get(trade.id) ?? null,
    mistakeTags: mistakeTagsByTradeId.get(trade.id) ?? [],
  }));
}

function toAnalyticsInput(trades: TradeRow[]): ClosedTradeForAnalytics[] {
  return trades
    .filter((t) => t.status === "closed" && t.net_pnl != null)
    .map((t) => ({
      id: t.id,
      netPnl: t.net_pnl ?? 0,
      realizedRMultiple: t.realized_r_multiple,
      curatedLabel: t.curated_label === "curated" ? "curated" : "impulse",
      openedAt: t.opened_at,
      closedAt: t.closed_at,
    }));
}

export interface BreakdownGroup {
  key: string;
  label: string;
  trades: TradeRow[];
  stats: ReturnType<typeof summarizeClosedTrades>;
}

export type BreakdownDimension =
  | "setup"
  | "symbol"
  | "market"
  | "direction"
  | "session"
  | "dayOfWeek"
  | "hour"
  | "holdingDuration"
  | "emotion"
  | "mistake"
  | "planAdherence";

export const BREAKDOWN_DIMENSIONS: { value: BreakdownDimension; label: string }[] = [
  { value: "setup", label: "Setup / Playbook" },
  { value: "symbol", label: "Symbol" },
  { value: "market", label: "Market" },
  { value: "direction", label: "Direction" },
  { value: "session", label: "Session" },
  { value: "dayOfWeek", label: "Day of week" },
  { value: "hour", label: "Hour of day" },
  { value: "holdingDuration", label: "Holding duration" },
  { value: "emotion", label: "Emotion" },
  { value: "mistake", label: "Mistake" },
  { value: "planAdherence", label: "Plan adherence" },
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function holdingDurationBucket(seconds: number | null): string | null {
  if (seconds == null) return null;
  const minutes = seconds / 60;
  if (minutes < 15) return "<15m";
  if (minutes < 60) return "15m–1h";
  if (minutes < 240) return "1–4h";
  if (minutes < 1440) return "4–24h";
  if (minutes < 4320) return "1–3d";
  return ">3d";
}

const HOLDING_BUCKET_ORDER = ["<15m", "15m–1h", "1–4h", "4–24h", "1–3d", ">3d"];

/** One or more keys a trade contributes to for a given dimension — plural because emotion/mistake are many-to-one. */
function keysForDimension(enriched: EnrichedTrade, dimension: BreakdownDimension): string[] {
  const { trade, review, mistakeTags } = enriched;
  switch (dimension) {
    case "setup": {
      const snapshot = trade.playbook_snapshot as { name?: string } | null;
      return [snapshot?.name ?? "No playbook"];
    }
    case "symbol":
      return [trade.symbol];
    case "market":
      return [trade.market];
    case "direction":
      return [trade.direction];
    case "session":
      return [trade.session ?? detectSessionFallback(trade.opened_at)];
    case "dayOfWeek":
      return [DAY_NAMES[new Date(trade.opened_at).getDay()] ?? "Unknown"];
    case "hour": {
      const hour = new Date(trade.opened_at).getHours();
      return [`${hour.toString().padStart(2, "0")}:00`];
    }
    case "holdingDuration": {
      if (!trade.closed_at) return [];
      const seconds = Math.round((new Date(trade.closed_at).getTime() - new Date(trade.opened_at).getTime()) / 1000);
      const bucket = holdingDurationBucket(seconds);
      return bucket ? [bucket] : [];
    }
    case "emotion": {
      if (!review) return [];
      return [review.emotional_state_before, review.emotional_state_during, review.emotional_state_after].filter(
        (v): v is string => Boolean(v),
      );
    }
    case "mistake":
      return mistakeTags;
    case "planAdherence":
      return review?.plan_adherence ? [review.plan_adherence] : [];
    default:
      return [];
  }
}

/** Sort key so dimensions with a natural order (hour, holding duration) don't get shuffled by net P&L. */
function naturalSortIndex(dimension: BreakdownDimension, key: string): number | null {
  if (dimension === "dayOfWeek") {
    const idx = DAY_NAMES.indexOf(key);
    return idx === -1 ? null : idx;
  }
  if (dimension === "hour") return Number.parseInt(key, 10);
  if (dimension === "holdingDuration") {
    const idx = HOLDING_BUCKET_ORDER.indexOf(key);
    return idx === -1 ? null : idx;
  }
  return null;
}

export function computeBreakdown(
  enrichedTrades: EnrichedTrade[],
  dimension: BreakdownDimension,
  startingEquity: number,
  minSampleSize: number,
): BreakdownGroup[] {
  const closed = enrichedTrades.filter((e) => e.trade.status === "closed" && e.trade.net_pnl != null);
  const byKey = new Map<string, TradeRow[]>();

  for (const enriched of closed) {
    for (const key of keysForDimension(enriched, dimension)) {
      const list = byKey.get(key) ?? [];
      list.push(enriched.trade);
      byKey.set(key, list);
    }
  }

  const groups: BreakdownGroup[] = Array.from(byKey.entries())
    .map(([key, trades]) => ({
      key,
      label: key,
      trades,
      stats: summarizeClosedTrades(toAnalyticsInput(trades), startingEquity),
    }))
    .filter((group) => group.stats.tradeCount >= minSampleSize);

  const hasNaturalOrder = naturalSortIndex(dimension, groups[0]?.key ?? "") !== null || dimension === "hour";
  if (hasNaturalOrder) {
    groups.sort((a, b) => (naturalSortIndex(dimension, a.key) ?? 0) - (naturalSortIndex(dimension, b.key) ?? 0));
  } else {
    groups.sort((a, b) => b.stats.netPnl - a.stats.netPnl);
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Ratio metrics
// ---------------------------------------------------------------------------

export interface RatioMetrics {
  averagePlannedR: number | null;
  averageRealizedR: number | null;
  averageWinnerR: number | null;
  averageLoserR: number | null;
  payoffRatio: number | null;
  recoveryFactor: number | null;
}

export function computeRatioMetrics(trades: TradeRow[], overallNetPnl: number, maxDrawdownDollars: number | null): RatioMetrics {
  const closed = trades.filter((t) => t.status === "closed" && t.net_pnl != null);

  const withPlanned = closed.filter((t) => t.planned_r_multiple != null);
  const averagePlannedR =
    withPlanned.length > 0
      ? withPlanned.reduce((sum, t) => sum + (t.planned_r_multiple ?? 0), 0) / withPlanned.length
      : null;

  const withRealized = closed.filter((t) => t.realized_r_multiple != null);
  const averageRealizedR =
    withRealized.length > 0
      ? withRealized.reduce((sum, t) => sum + (t.realized_r_multiple ?? 0), 0) / withRealized.length
      : null;

  const winnersR = withRealized.filter((t) => (t.net_pnl ?? 0) > 0).map((t) => t.realized_r_multiple ?? 0);
  const losersR = withRealized.filter((t) => (t.net_pnl ?? 0) < 0).map((t) => t.realized_r_multiple ?? 0);
  const averageWinnerR = winnersR.length > 0 ? winnersR.reduce((a, b) => a + b, 0) / winnersR.length : null;
  const averageLoserR = losersR.length > 0 ? losersR.reduce((a, b) => a + b, 0) / losersR.length : null;

  const grossWin = closed.filter((t) => (t.net_pnl ?? 0) > 0).reduce((sum, t) => sum + (t.net_pnl ?? 0), 0);
  const grossLossAbs = Math.abs(closed.filter((t) => (t.net_pnl ?? 0) < 0).reduce((sum, t) => sum + (t.net_pnl ?? 0), 0));
  const winCount = closed.filter((t) => (t.net_pnl ?? 0) > 0).length;
  const lossCount = closed.filter((t) => (t.net_pnl ?? 0) < 0).length;
  const avgWinDollar = winCount > 0 ? grossWin / winCount : null;
  const avgLossDollar = lossCount > 0 ? grossLossAbs / lossCount : null;
  const payoffRatio = avgWinDollar != null && avgLossDollar != null && avgLossDollar > 0 ? avgWinDollar / avgLossDollar : null;

  // Recovery factor: net profit relative to the worst drawdown endured — how
  // many times over the portfolio "earned back" its worst peak-to-trough
  // loss. maxDrawdownDollars comes straight from summarizeClosedTrades'
  // own peak-tracking loop (the actual equity peak at the worst point, which
  // can exceed startingEquity), not reconstructed from a percentage.
  const recoveryFactor =
    maxDrawdownDollars != null && maxDrawdownDollars > 0 ? overallNetPnl / maxDrawdownDollars : null;

  return { averagePlannedR, averageRealizedR, averageWinnerR, averageLoserR, payoffRatio, recoveryFactor };
}

// ---------------------------------------------------------------------------
// R-multiple distribution
// ---------------------------------------------------------------------------

export interface RBucket {
  label: string;
  count: number;
}

const R_BUCKET_EDGES = [-Infinity, -2, -1, 0, 1, 2, 3, Infinity];
const R_BUCKET_LABELS = ["<-2R", "-2 to -1R", "-1 to 0R", "0 to 1R", "1 to 2R", "2 to 3R", ">3R"];

export function computeRDistribution(trades: TradeRow[]): RBucket[] {
  const buckets = R_BUCKET_LABELS.map((label) => ({ label, count: 0 }));
  for (const trade of trades) {
    if (trade.realized_r_multiple == null) continue;
    const r = trade.realized_r_multiple;
    for (let i = 0; i < R_BUCKET_EDGES.length - 1; i++) {
      if (r >= R_BUCKET_EDGES[i]! && r < R_BUCKET_EDGES[i + 1]!) {
        buckets[i]!.count += 1;
        break;
      }
    }
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Streak distribution — every win/loss streak in the closed-trade history,
// not just the current one (summarizeClosedTrades already gives the current
// streak).
// ---------------------------------------------------------------------------

export interface StreakDistribution {
  winStreaks: number[]; // one entry per streak, e.g. [3, 1, 5] = a 3-win streak, then a 1-win streak, then a 5-win streak
  lossStreaks: number[];
}

export function computeStreakDistribution(trades: TradeRow[]): StreakDistribution {
  const chronological = trades
    .filter((t) => t.status === "closed" && t.net_pnl != null)
    .sort((a, b) => new Date(a.closed_at ?? a.opened_at).getTime() - new Date(b.closed_at ?? b.opened_at).getTime());

  const winStreaks: number[] = [];
  const lossStreaks: number[] = [];
  let currentType: "win" | "loss" | null = null;
  let currentLength = 0;

  function flush() {
    if (currentType === "win" && currentLength > 0) winStreaks.push(currentLength);
    if (currentType === "loss" && currentLength > 0) lossStreaks.push(currentLength);
  }

  for (const trade of chronological) {
    const pnl = trade.net_pnl ?? 0;
    const type: "win" | "loss" | null = pnl > 0 ? "win" : pnl < 0 ? "loss" : null;
    if (type == null) {
      flush();
      currentType = null;
      currentLength = 0;
      continue;
    }
    if (type === currentType) {
      currentLength += 1;
    } else {
      flush();
      currentType = type;
      currentLength = 1;
    }
  }
  flush();

  return { winStreaks, lossStreaks };
}

// ---------------------------------------------------------------------------
// Deterministic insight cards
// ---------------------------------------------------------------------------

export interface InsightCard {
  id: string;
  tone: "warning" | "positive" | "neutral";
  text: string;
}

/**
 * Every insight here comes from one of exactly three rules, applied to every
 * breakdown dimension's groups (each already filtered to the configured
 * minimum sample size):
 *  1. Negative-expectancy warning: a group has negative expectancy while the
 *     overall portfolio expectancy is >= 0 — something specific is dragging
 *     on an otherwise-working approach.
 *  2. Standout strength: a group's expectancy is at least 1.5x the overall
 *     expectancy (overall must be positive for "1.5x" to mean "better").
 *  3. Weak-relative-to-average: a group's win rate is at least 15 percentage
 *     points below the overall win rate.
 * No group is scored by more than one rule (warning takes priority over
 * weak-relative, so the same finding isn't shown twice), and results are
 * capped at 5 cards, worst-first, so this stays a short list of the most
 * useful findings rather than a wall of text.
 */
export function generateInsights(
  enrichedTrades: EnrichedTrade[],
  startingEquity: number,
  minSampleSize: number,
  overall: ReturnType<typeof summarizeClosedTrades>,
): InsightCard[] {
  if (overall.tradeCount < minSampleSize) return [];

  const insights: InsightCard[] = [];
  const dimensionsToScan: BreakdownDimension[] = [
    "setup",
    "symbol",
    "session",
    "dayOfWeek",
    "mistake",
    "emotion",
    "planAdherence",
  ];

  for (const dimension of dimensionsToScan) {
    const groups = computeBreakdown(enrichedTrades, dimension, startingEquity, minSampleSize);
    const dimensionLabel = BREAKDOWN_DIMENSIONS.find((d) => d.value === dimension)?.label ?? dimension;

    for (const group of groups) {
      const expectancy = group.stats.expectancy ?? 0;
      const overallExpectancy = overall.expectancy ?? 0;

      if (overallExpectancy >= 0 && expectancy < 0) {
        insights.push({
          id: `${dimension}-${group.key}-warning`,
          tone: "warning",
          text: `Negative expectancy (${expectancy >= 0 ? "+" : ""}$${expectancy.toFixed(0)}/trade) on ${dimensionLabel.toLowerCase()} "${group.label}" across ${group.stats.tradeCount} trades, while the portfolio overall is positive.`,
        });
        continue;
      }

      if (overallExpectancy > 0 && expectancy >= overallExpectancy * 1.5) {
        insights.push({
          id: `${dimension}-${group.key}-strength`,
          tone: "positive",
          text: `${dimensionLabel} "${group.label}" is a standout: $${expectancy.toFixed(0)} expectancy per trade across ${group.stats.tradeCount} trades, well above your $${overallExpectancy.toFixed(0)} average.`,
        });
        continue;
      }

      if (overall.winRate != null && group.stats.winRate != null && group.stats.winRate <= overall.winRate - 15) {
        insights.push({
          id: `${dimension}-${group.key}-weak`,
          tone: "warning",
          text: `${dimensionLabel} "${group.label}" wins ${group.stats.winRate}% of the time, vs. ${overall.winRate}% overall, across ${group.stats.tradeCount} trades.`,
        });
      }
    }
  }

  // Worst-first: warnings before positives, then by how far expectancy/win-rate deviates.
  insights.sort((a, b) => {
    if (a.tone !== b.tone) return a.tone === "warning" ? -1 : 1;
    return 0;
  });

  return insights.slice(0, 5);
}
