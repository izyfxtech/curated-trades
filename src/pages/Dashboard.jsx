import React, { useState, useMemo } from "react";
import { entities } from '@/api/entities';
import { useQuery } from "@tanstack/react-query";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { DollarSign, Target, TrendingUp, BarChart3, Percent, Zap, Settings2, Plus, Check, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatCard from "@/components/dashboard/StatCard";
import EquityCurve from "@/components/dashboard/EquityCurve";
import RecentTrades from "@/components/dashboard/RecentTrades";
import WinLossChart from "@/components/dashboard/WinLossChart";
import SessionAnalysis from "@/components/analytics/SessionAnalysis";
import StrategyBreakdown from "@/components/analytics/StrategyBreakdown";
import WinLossDistribution from "@/components/analytics/WinLossDistribution";
import AddWidgetSidebar from "@/components/dashboard/AddWidgetSidebar";
import { calcStats, formatCurrency } from "@/lib/tradeUtils";
import { cn } from "@/lib/utils";

const DEFAULT_LAYOUT = [
  "stats_row",       // special grouped stat cards row
  "equity_curve",
  "win_loss_chart",
  "recent_trades",
];

// Stat cards that live inside the "stats_row" group
const DEFAULT_STATS = ["stat_pnl", "stat_winrate", "stat_trades", "stat_factor", "stat_avgwin", "stat_avgloss"];

const ALL_STAT_IDS = new Set([
  "stat_pnl", "stat_winrate", "stat_trades", "stat_factor", "stat_avgwin", "stat_avgloss",
]);

function useStoredLayout(key, defaults) {
  const stored = localStorage.getItem(key);
  const initial = stored ? JSON.parse(stored) : defaults;
  const [val, setVal] = useState(initial);
  const save = (v) => { setVal(v); localStorage.setItem(key, JSON.stringify(v)); };
  return [val, save];
}

export default function Dashboard() {
  const [layout, saveLayout] = useStoredLayout("ct_dash_layout_v2", DEFAULT_LAYOUT);
  const [stats_row, saveStatsRow] = useStoredLayout("ct_dash_statsrow_v2", DEFAULT_STATS);
  const [isEditing, setIsEditing] = useState(false);
  const [showAddSidebar, setShowAddSidebar] = useState(false);

  const { data: trades = [], isLoading } = useQuery({
    queryKey: ["trades"],
    queryFn: () => entities.Trade.list("-close_time", 500),
  });

  const stats = useMemo(() => calcStats(trades), [trades]);

  const removeWidget = (id) => {
    if (id === "stats_row") { saveLayout(layout.filter(w => w !== id)); return; }
    if (ALL_STAT_IDS.has(id)) { saveStatsRow(stats_row.filter(s => s !== id)); return; }
    saveLayout(layout.filter(w => w !== id));
  };

  const addWidget = (id) => {
    if (ALL_STAT_IDS.has(id)) {
      if (!stats_row.includes(id)) saveStatsRow([...stats_row, id]);
      if (!layout.includes("stats_row")) saveLayout(["stats_row", ...layout]);
      return;
    }
    if (!layout.includes(id)) saveLayout([...layout, id]);
  };

  const doneEditing = () => { setIsEditing(false); setShowAddSidebar(false); };

  const onDragEnd = (result) => {
    if (!result.destination) return;
    if (result.source.droppableId === "dashboard") {
      const newLayout = Array.from(layout);
      const [removed] = newLayout.splice(result.source.index, 1);
      newLayout.splice(result.destination.index, 0, removed);
      saveLayout(newLayout);
    }
    if (result.source.droppableId === "stats_row") {
      const newStats = Array.from(stats_row);
      const [removed] = newStats.splice(result.source.index, 1);
      newStats.splice(result.destination.index, 0, removed);
      saveStatsRow(newStats);
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
    stat_pnl:     { label: "Net P&L",      value: formatCurrency(stats.totalPnl), variant: stats.totalPnl >= 0 ? "profit" : "loss", icon: DollarSign },
    stat_winrate: { label: "Win Rate",     value: `${stats.winRate.toFixed(1)}%`, icon: Target },
    stat_trades:  { label: "Total Trades", value: stats.totalTrades, icon: BarChart3 },
    stat_factor:  { label: "Profit Factor",value: stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2), icon: TrendingUp },
    stat_avgwin:  { label: "Avg Win",      value: formatCurrency(stats.avgWin), variant: "profit", icon: Zap },
    stat_avgloss: { label: "Avg Loss",     value: formatCurrency(stats.avgLoss > 0 ? -stats.avgLoss : stats.avgLoss), variant: "loss", icon: Percent },
  };

  const renderWidgetContent = (id) => {
    if (id === "equity_curve")       return <EquityCurve trades={trades} />;
    if (id === "win_loss_chart")     return <WinLossChart trades={trades} />;
    if (id === "session_analysis")   return <SessionAnalysis trades={trades} />;
    if (id === "win_loss_dist")      return <WinLossDistribution trades={trades} />;
    if (id === "strategy_breakdown") return <StrategyBreakdown trades={trades} />;
    if (id === "recent_trades")      return <RecentTrades trades={trades} />;
    return null;
  };

  // All active widget ids (for the sidebar "already added" check)
  const allActiveIds = [...layout, ...stats_row];

  return (
    <div className={cn("space-y-4 max-w-7xl transition-all duration-200", showAddSidebar && "mr-80")}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Your trading performance at a glance</p>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setShowAddSidebar(s => !s)}>
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
          <span>Drag to reorder — hover to reveal grip handle and remove button.</span>
        </div>
      )}

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="dashboard">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-4">
              {layout.map((id, index) => {
                if (id === "stats_row") {
                  return (
                    <Draggable key="stats_row" draggableId="stats_row" index={index} isDragDisabled={!isEditing}>
                      {(drag, snapshot) => (
                        <div
                          ref={drag.innerRef}
                          {...drag.draggableProps}
                          className={cn(snapshot.isDragging && "opacity-80 z-50")}
                        >
                          <div className="relative group/statsrow">
                            {isEditing && (
                              <>
                                <div
                                  {...drag.dragHandleProps}
                                  className="absolute -top-1 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-secondary/90 border border-border flex items-center gap-1 opacity-0 group-hover/statsrow:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
                                >
                                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
                                  <span className="text-[10px] text-muted-foreground">Drag stat row</span>
                                </div>
                                <button
                                  onClick={() => removeWidget("stats_row")}
                                  className="absolute -top-2 -right-2 z-10 w-6 h-6 rounded-full bg-destructive text-white flex items-center justify-center shadow-lg hover:scale-110 transition-transform opacity-0 group-hover/statsrow:opacity-100"
                                >
                                  <span className="text-xs font-bold leading-none">−</span>
                                </button>
                              </>
                            )}
                            {/* Stat cards with their own DnD */}
                            <Droppable droppableId="stats_row" direction="horizontal">
                              {(statProvided) => (
                                <div
                                  ref={statProvided.innerRef}
                                  {...statProvided.droppableProps}
                                  className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3"
                                >
                                  {stats_row.map((sid, si) => {
                                    const def = statDefs[sid];
                                    if (!def) return null;
                                    return (
                                      <Draggable key={sid} draggableId={sid} index={si} isDragDisabled={!isEditing}>
                                        {(sdrag, ssnap) => (
                                          <div
                                            ref={sdrag.innerRef}
                                            {...sdrag.draggableProps}
                                            className={cn("relative group/stat", ssnap.isDragging && "opacity-75 z-50")}
                                          >
                                            {isEditing && (
                                              <>
                                                <div {...sdrag.dragHandleProps} className="absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded bg-secondary/80 flex items-center justify-center opacity-0 group-hover/stat:opacity-100 transition-opacity cursor-grab">
                                                  <GripVertical className="w-3 h-3 text-muted-foreground" />
                                                </div>
                                                <button
                                                  onClick={() => removeWidget(sid)}
                                                  className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center shadow-md hover:scale-110 transition-transform opacity-0 group-hover/stat:opacity-100"
                                                >
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
                                  {statProvided.placeholder}
                                </div>
                              )}
                            </Droppable>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  );
                }

                const content = renderWidgetContent(id);
                if (!content) return null;

                return (
                  <Draggable key={id} draggableId={id} index={index} isDragDisabled={!isEditing}>
                    {(drag, snapshot) => (
                      <div
                        ref={drag.innerRef}
                        {...drag.draggableProps}
                        className={cn("relative group/widget", snapshot.isDragging && "opacity-80 z-50")}
                      >
                        {isEditing && (
                          <>
                            <div
                              {...drag.dragHandleProps}
                              className="absolute top-3 left-3 z-10 w-7 h-7 rounded-md bg-secondary/90 border border-border flex items-center justify-center opacity-0 group-hover/widget:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
                            >
                              <GripVertical className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <button
                              onClick={() => removeWidget(id)}
                              className="absolute -top-2 -right-2 z-10 w-6 h-6 rounded-full bg-destructive text-white flex items-center justify-center shadow-lg hover:scale-110 transition-transform opacity-0 group-hover/widget:opacity-100"
                            >
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

      {showAddSidebar && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={() => setShowAddSidebar(false)} />
          <AddWidgetSidebar
            activeWidgets={allActiveIds}
            onAdd={addWidget}
            onClose={() => setShowAddSidebar(false)}
          />
        </>
      )}
    </div>
  );
}
