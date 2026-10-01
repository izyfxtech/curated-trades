import { formatMoneyCompact } from "@/lib/money";

// Chart-layout math for the equity curve (SVG coordinate mapping), kept
// separate from trade-calc.ts on purpose — that file is per-trade financial
// math, this is presentation math for a specific chart. Same separation
// reasoning as prop-firm-calc.ts living apart from trade-calc.ts.
export interface ClosedTradeForEquityCurve {
  id: string;
  symbol: string;
  netPnl: number | null;
  openedAt: string;
  closedAt: string | null;
}

export interface EquityCurvePoint {
  x: number;
  y: number;
  value: number;
  date: string;
  /** null only for the starting-equity anchor — nothing to link to before the first trade. */
  tradeId: string | null;
  symbol: string | null;
  netPnl: number | null;
}

export interface EquityCurveResult {
  points: EquityCurvePoint[];
  /** Precomputed "x,y x,y ..." for the connecting <polyline>, derived from `points`. */
  polyline: string;
  labels: string[];
  current: number;
  width: number;
  height: number;
}

export function buildEquityCurve(
  closedTrades: ClosedTradeForEquityCurve[],
  startingEquity: number,
  options: { width?: number; height?: number; currency?: string } = {},
): EquityCurveResult {
  const currency = options.currency ?? "USD";
  const width = options.width ?? 630;
  const height = options.height ?? 170;
  const padTop = 14;
  const padBottom = 20;

  const chronological = [...closedTrades].sort(
    (a, b) => new Date(a.closedAt ?? a.openedAt).getTime() - new Date(b.closedAt ?? b.openedAt).getTime(),
  );

  const raw: { value: number; date: string; tradeId: string | null; symbol: string | null; netPnl: number | null }[] = [
    { value: startingEquity, date: chronological[0]?.openedAt ?? new Date().toISOString(), tradeId: null, symbol: null, netPnl: null },
  ];
  let running = startingEquity;
  for (const trade of chronological) {
    running += trade.netPnl ?? 0;
    raw.push({ value: running, date: trade.closedAt ?? trade.openedAt, tradeId: trade.id, symbol: trade.symbol, netPnl: trade.netPnl });
  }
  if (raw.length < 2) {
    const anchor = raw[0]!;
    raw.push({ value: anchor.value, date: new Date().toISOString(), tradeId: null, symbol: null, netPnl: null });
  }

  const values = raw.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (raw.length - 1 || 1);

  const points: EquityCurvePoint[] = raw.map((point, index) => ({
    x: Number((index * step).toFixed(1)),
    y: Number((height - padTop - ((point.value - min) / range) * (height - padTop - padBottom)).toFixed(1)),
    value: point.value,
    date: point.date,
    tradeId: point.tradeId,
    symbol: point.symbol,
    netPnl: point.netPnl,
  }));

  const labels = [max, min + range * 0.66, min + range * 0.33, min].map((value) => formatMoneyCompact(value, currency));

  return {
    points,
    polyline: points.map((p) => `${p.x},${p.y}`).join(" "),
    labels,
    current: values[values.length - 1] ?? startingEquity,
    width,
    height,
  };
}

/** Thins an equity curve to roughly `maxPoints` vertices for sending over the
 * wire / drawing, without changing what it looks like.
 *
 * A journal with 20,000 trades has a 20,000-point curve — far more vertices
 * than the ~900px-wide chart can show. Each point keeps its original x/y, so
 * the geometry is untouched; what's dropped is points that sit between other
 * points on a visually identical line. Within each bucket of consecutive
 * points we keep the *highest*, the *lowest* and the *last*, so no peak or
 * drawdown trough is ever smoothed away (the y-scale and labels come from the
 * full series before this runs). Curves already under the limit are returned
 * unchanged — normal journals see no difference at all. */
export function downsampleEquityCurve(curve: EquityCurveResult, maxPoints = 600): EquityCurveResult {
  const { points } = curve;
  if (points.length <= maxPoints) return curve;

  const bucketCount = Math.max(1, Math.floor(maxPoints / 3));
  const bucketSize = points.length / bucketCount;
  const keep = new Set<number>([0, points.length - 1]);
  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor(b * bucketSize);
    const end = Math.min(points.length, Math.floor((b + 1) * bucketSize));
    if (end <= start) continue;
    let lo = start;
    let hi = start;
    for (let i = start; i < end; i++) {
      if (points[i]!.value < points[lo]!.value) lo = i;
      if (points[i]!.value > points[hi]!.value) hi = i;
    }
    keep.add(lo);
    keep.add(hi);
    keep.add(end - 1);
  }

  const kept = [...keep].sort((a, b) => a - b).map((index) => points[index]!);
  return { ...curve, points: kept, polyline: kept.map((p) => `${p.x},${p.y}`).join(" ") };
}
