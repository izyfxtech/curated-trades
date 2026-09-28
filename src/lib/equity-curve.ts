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
  options: { width?: number; height?: number } = {},
): EquityCurveResult {
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

  const labels = [max, min + range * 0.66, min + range * 0.33, min].map((value) => `$${Math.round(value / 1000)}k`);

  return {
    points,
    polyline: points.map((p) => `${p.x},${p.y}`).join(" "),
    labels,
    current: values[values.length - 1] ?? startingEquity,
    width,
    height,
  };
}
