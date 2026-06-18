import React, { useMemo, useState } from "react";
import { useTradeFilter } from "@/lib/TradeFilterContext";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { calcStats, formatCurrency } from "@/lib/tradeUtils";
import StatCard from "@/components/dashboard/StatCard";
import EquityCurve from "@/components/dashboard/EquityCurve";
import { DollarSign, Target, TrendingUp, BarChart3, Percent, Zap, Settings2, Plus, Check, GripVertical, Activity, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import SessionAnalysis from "@/components/analytics/SessionAnalysis";
import StrategyBreakdown from "@/components/analytics/StrategyBreakdown";
import WinLossDistribution from "@/components/analytics/WinLossDistribution";
import SymbolsBreakdown from "@/components/analytics/SymbolsBreakdown";
import RiskStatsPanel from "@/components/analytics/RiskStatsPanel";
import ProfitChart from "@/components/analytics/ProfitChart";
import BalanceChart from "@/components/analytics/BalanceChart";
import { cn } from "@/lib/utils";
import AddAnalyticsWidgetSidebar, { ANALYTICS_WIDGETS } from "@/components/analytics/AddAnalyticsWidgetSidebar";

const STAT_IDS = new Set([
  "stat_pnl", "stat_winrate", "stat_trades", "stat_factor",
  "stat_expectancy", "stat_avgwin", "stat_avgloss",
  "stat_beststrade", "stat_worstrade", "stat_avgrr",
]);



const DEFAULT_LAYOUT = [
  "stats_row",
  "profit_chart",
  "balance_chart",
  "risk_symbols_pair",   // risk + symbols side by side
  "dist_session_pair",   // dist + session side by side
  "equity_curve",
  "strategy_breakdown",
];

const DEFAULT_STATS = [
  "stat_pnl", "stat_winrate", "stat_trades", "stat_factor", "stat_expectancy", "stat_avgwin",
];

function useStoredLayout(key, defaults) {
  const stored = localStorage.getItem(key);
  const initial = stored ? JSON.parse(stored) : defaults;
  const [val, setVal] = useState(initial);
  const save = (v) => { setVal(v); localStorage.setItem(key, JSON.stringify(v)); };
  return [val, save];
}

export default function Analytics() {
  const [layout, saveLayout] = useStoredLayout("ct_analytics_layout_v2", DEFAULT_LAYOUT);
  const [stats_row, saveStatsRow] = useStoredLayout("ct_analytics_statsrow_v2", DEFAULT_STATS);
  const [isEditing, setIsEditing] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);

  const { filteredTrades: trades, tradesLoading: isLoading, startingBalance } = useTradeFilter();
  const stats = useMemo(() => calcStats(trades), [trades]);

  const removeWidget = (id) => {
    if (id === "stats_row") { saveLayout(layout.filter(w => w !== id)); return; }
    if (STAT_IDS.has(id)) { saveStatsRow(stats_row.filter(s => s !== id)); return; }
    saveLayout(layout.filter(w => w !== id));
  };

  const addWidget = (id) => {
    if (STAT_IDS.has(id)) {
      if (!stats_row.includes(id)) saveStatsRow([...stats_row, id]);
      if (!layout.includes("stats_row")) saveLayout(["stats_row", ...layout]);
      return;
    }
    if (!layout.includes(id)) saveLayout([...layout, id]);
  };

  const doneEditing = () => { setIsEditing(false); setShowAddPanel(false); };

  const onDragEnd = (result) => {
    if (!result.destination) return;
    if (result.source.droppableId === "analytics") {
      const nl = Array.from(layout);
      const [r] = nl.splice(result.source.index, 1);
      nl.splice(result.destination.index, 0, r);
      saveLayout(nl);
    }
    if (result.source.droppableId === "analytics_stats") {
      const ns = Array.from(stats_row);
      const [r] = ns.splice(result.source.index, 1);
      ns.splice(result.destination.index, 0, r);
      saveStatsRow(ns);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const statDefs = {
    stat_pnl:       { label: "Net P&L",       value: formatCurrency(stats.totalPnl),    variant: stats.totalPnl >= 0 ? "profit" : "loss", icon: DollarSign },
    stat_winrate:   { label: "Win Rate",       value: `${stats.winRate.toFixed(1)}%`,    icon: Target },
    stat_trades:    { label: "Total Trades",   value: stats.totalTrades,                  icon: BarChart3 },
    stat_factor:    { label: "Profit Factor",  value: stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2), icon: TrendingUp },
    stat_expectancy:{ label: "Expectancy",     value: formatCurrency(stats.expectancy),  variant: stats.expectancy >= 0 ? "profit" : "loss", icon: Zap },
    stat_avgwin:    { label: "Avg Win",        value: formatCurrency(stats.avgWin),      variant: "profit", icon: TrendingUp },
    stat_avgloss:   { label: "Avg Loss",       value: formatCurrency(stats.avgLoss > 0 ? -stats.avgLoss : stats.avgLoss), variant: "loss", icon: Percent },
    stat_beststrade:{ label: "Best Trade",     value: formatCurrency(stats.bestTrade),   variant: "profit", icon: Activity },
    stat_worstrade: { label: "Worst Trade",    value: formatCurrency(stats.worstTrade),  variant: "loss",   icon: Clock },
    stat_avgrr:     { label: "Avg R:R",        value: stats.avgRR?.toFixed(2) || "—",   icon: Target },
  };

  const renderContent = (id) => {
    if (id === "profit_chart")       return <ProfitChart trades={trades} />;
    if (id === "balance_chart")      return <BalanceChart trades={trades} startingBalance={startingBalance} />;
    if (id === "equity_curve")       return <EquityCurve trades={trades} startingBalance={startingBalance} />;
    if (id === "risk_symbols_pair")  return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RiskStatsPanel trades={trades} />
        <SymbolsBreakdown trades={trades} />
      </div>
    );
    if (id === "risk_panel")         return <RiskStatsPanel trades={trades} />;
    if (id === "symbols_breakdown")  return <SymbolsBreakdown trades={trades} />;
    if (id === "dist_session_pair")  return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WinLossDistribution trades={trades} />
        <SessionAnalysis trades={trades} />
      </div>
    );
    if (id === "win_loss_dist")      return <WinLossDistribution trades={trades} />;
    if (id === "session_analysis")   return <SessionAnalysis trades={trades} />;
    if (id === "strategy_breakdown") return <StrategyBreakdown trades={trades} />;
    return null;
  };



  const allActiveIds = [...layout, ...stats_row];

  return (
    <div className={cn("space-y-4 max-w-7xl transition-all duration-200", showAddPanel && "mr-72")}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Deep dive into your trading performance</p>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setShowAddPanel(s => !s)}>
                <Plus className="w-4 h-4 mr-1.5" />Add Widget
              </Button>
              <Button size="sm" onClick={doneEditing}>
                <Check className="w-4 h-4 mr-1.5" />Done
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
              <Settings2 className="w-4 h-4 mr-2" />Customize
            </Button>
          )}
        </div>
      </div>

      {isEditing && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 border border-primary/30 rounded-xl text-sm text-primary">
          <GripVertical className="w-4 h-4 flex-shrink-0" />
          <span>Drag to reorder — hover to reveal grip and remove button.</span>
        </div>
      )}

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="analytics">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-4">
              {layout.map((id, index) => {
                if (id === "stats_row") {
                  return (
                    <Draggable key="stats_row" draggableId="stats_row" index={index} isDragDisabled={!isEditing}>
                      {(drag, snapshot) => (
                        <div ref={drag.innerRef} {...drag.draggableProps} className={cn(snapshot.isDragging && "opacity-80 z-50")}>
                          <div className="relative group/statsrow">
                            {isEditing && (
                              <>
                                <div {...drag.dragHandleProps} className="absolute -top-1 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-secondary/90 border border-border flex items-center gap-1 opacity-0 group-hover/statsrow:opacity-100 transition-opacity cursor-grab">
                                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
                                  <span className="text-[10px] text-muted-foreground">Drag stat row</span>
                                </div>
                                <button onClick={() => removeWidget("stats_row")} className="absolute -top-2 -right-2 z-10 w-6 h-6 rounded-full bg-destructive text-white flex items-center justify-center shadow-lg hover:scale-110 transition-transform opacity-0 group-hover/statsrow:opacity-100">
                                  <span className="text-xs font-bold leading-none">−</span>
                                </button>
                              </>
                            )}
                            <Droppable droppableId="analytics_stats" direction="horizontal">
                              {(sp) => (
                                <div ref={sp.innerRef} {...sp.droppableProps} className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                                  {stats_row.map((sid, si) => {
                                    const def = statDefs[sid];
                                    if (!def) return null;
                                    return (
                                      <Draggable key={sid} draggableId={`a_${sid}`} index={si} isDragDisabled={!isEditing}>
                                        {(sdrag, ssnap) => (
                                          <div ref={sdrag.innerRef} {...sdrag.draggableProps} className={cn("relative group/stat", ssnap.isDragging && "opacity-75 z-50")}>
                                            {isEditing && (
                                              <>
                                                <div {...sdrag.dragHandleProps} className="absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded bg-secondary/80 flex items-center justify-center opacity-0 group-hover/stat:opacity-100 transition-opacity cursor-grab">
                                                  <GripVertical className="w-3 h-3 text-muted-foreground" />
                                                </div>
                                                <button onClick={() => removeWidget(sid)} className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center shadow-md hover:scale-110 transition-transform opacity-0 group-hover/stat:opacity-100">
                                                  <span className="text-[10px] font-bold leading-none">−</span>
                                                </button>
                                              </>
                                            )}
                                            <StatCard label={def.label} value={def.value} variant={def.variant} icon={def.icon} />
                                          </div>
                                        )}
                                      </Draggable>
                                    );
                                  })}
                                  {sp.placeholder}
                                </div>
                              )}
                            </Droppable>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  );
                }

                const content = renderContent(id);
                if (!content) return null;

                return (
                  <Draggable key={id} draggableId={id} index={index} isDragDisabled={!isEditing}>
                    {(drag, snapshot) => (
                      <div ref={drag.innerRef} {...drag.draggableProps} className={cn("relative group/widget", snapshot.isDragging && "opacity-80 z-50")}>
                        {isEditing && (
                          <>
                            <div {...drag.dragHandleProps} className="absolute top-3 left-3 z-10 w-7 h-7 rounded-md bg-secondary/90 border border-border flex items-center justify-center opacity-0 group-hover/widget:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
                              <GripVertical className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <button onClick={() => removeWidget(id)} className="absolute -top-2 -right-2 z-10 w-6 h-6 rounded-full bg-destructive text-white flex items-center justify-center shadow-lg hover:scale-110 transition-transform opacity-0 group-hover/widget:opacity-100">
                              <span className="text-xs font-bold leading-none">−</span>
                            </button>
                          </>
                        )}
                        {content}
                      </div>
                    )}
                  </Draggable>
                );
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {showAddPanel && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={() => setShowAddPanel(false)} />
          <AddAnalyticsWidgetSidebar
            activeWidgets={allActiveIds}
            onAdd={addWidget}
            onClose={() => setShowAddPanel(false)}
          />
        </>
      )}
    </div>
  );
}
