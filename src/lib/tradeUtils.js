export function calcStats(trades) {
  if (!trades?.length) return {
    totalPnl: 0, winRate: 0, avgWin: 0, avgLoss: 0,
    totalTrades: 0, wins: 0, losses: 0, breakevens: 0,
    avgRR: 0, profitFactor: 0, bestTrade: 0, worstTrade: 0,
    avgDuration: 0, expectancy: 0
  };

  const wins = trades.filter(t => (t.pnl || 0) > 0);
  const losses = trades.filter(t => (t.pnl || 0) < 0);
  const breakevens = trades.filter(t => (t.pnl || 0) === 0);

  const totalPnl = trades.reduce((s, t) => s + (t.net_pnl || t.pnl || 0), 0);
  const totalWinAmount = wins.reduce((s, t) => s + (t.net_pnl || t.pnl || 0), 0);
  const totalLossAmount = Math.abs(losses.reduce((s, t) => s + (t.net_pnl || t.pnl || 0), 0));

  const avgWin = wins.length ? totalWinAmount / wins.length : 0;
  const avgLoss = losses.length ? totalLossAmount / losses.length : 0;
  const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : totalWinAmount > 0 ? Infinity : 0;
  
  const rrs = trades.filter(t => t.risk_reward).map(t => t.risk_reward);
  const avgRR = rrs.length ? rrs.reduce((s, r) => s + r, 0) / rrs.length : 0;

  const durations = trades.filter(t => t.duration_minutes).map(t => t.duration_minutes);
  const avgDuration = durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;

  const pnls = trades.map(t => t.net_pnl || t.pnl || 0);
  const expectancy = pnls.length ? pnls.reduce((s, p) => s + p, 0) / pnls.length : 0;

  const pnlValues = pnls.filter(p => p !== 0);
  const mean = pnlValues.length ? pnlValues.reduce((s, p) => s + p, 0) / pnlValues.length : 0;
  const variance = pnlValues.length ? pnlValues.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / pnlValues.length : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

  return {
    totalPnl,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    avgWin,
    avgLoss,
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    avgRR,
    profitFactor,
    bestTrade: pnls.length ? Math.max(...pnls) : 0,
    worstTrade: pnls.length ? Math.min(...pnls) : 0,
    avgDuration,
    expectancy,
    stdDev,
    sharpeRatio,
  };
}

export function formatCurrency(value) {
  if (value === undefined || value === null) return "$0.00";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : value > 0 ? "+" : "";
  return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDuration(minutes) {
  if (!minutes) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}
