import React, { useState, useMemo } from "react";
import { useTradeFilter } from "@/lib/TradeFilterContext";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, addMonths, subMonths, isSameDay, isToday,
} from "date-fns";
import { ChevronLeft, ChevronRight, Settings2, Plus, Check, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import CalendarDayDetail from "@/components/calendar/CalendarDayDetail";
import CalendarMonthStats from "@/components/calendar/CalendarMonthStats";
import CalendarTopSymbols from "@/components/calendar/CalendarTopSymbols";
import EquityCurve from "@/components/dashboard/EquityCurve";
import ProfitChart from "@/components/analytics/ProfitChart";
import WinLossDistribution from "@/components/analytics/WinLossDistribution";
import SessionAnalysis from "@/components/analytics/SessionAnalysis";
import StrategyBreakdown from "@/components/analytics/StrategyBreakdown";
import StatCard from "@/components/dashboard/StatCard";
import AddCalendarWidgetSidebar from "@/components/calendar/AddCalendarWidgetSidebar";
import { calcStats, formatCurrency } from "@/lib/tradeUtils";
import { DollarSign, Target, TrendingUp, TrendingDown, Zap, BarChart3, Calendar } from "lucide-react";

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Widgets that appear below the calendar
const DEFAULT_BELOW_WIDGETS = ["cal_month_stats", "top_symbols"];

// Calendar stat tile IDs
const CAL_STAT_IDS = new Set([
  "stat_month_pnl", "stat_winrate", "stat_streak", "stat_best_day",
  "stat_worst_day", "stat_active_days", "stat_trades",
]);

function useStoredLayout(key, defaults) {
  const stored = localStorage.getItem(key);
  const initial = stored ? JSON.parse(stored) : defaults;
  const [val, setVal] = useState(initial);
  const save = (v) => { setVal(v); localStorage.setItem(key, JSON.stringify(v)); };
  return [val, save];
}

export default function ProfitCalendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showAddSidebar, setShowAddSidebar] = useState(false);
  const [belowLayout, saveBelowLayout] = useStoredLayout("ct_cal_below_v2", DEFAULT_BELOW_WIDGETS);

  const { filteredTrades: trades, startingBalance } = useTradeFilter();

  // Month-scoped trades
  const monthTrades = useMemo(() => {
    const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    return trades.filter(t => {
      const d = t.close_time || t.created_at;
      if (!d) return false;
      const date = new Date(d);
      return date >= start && date <= end;
    });
  }, [trades, currentMonth]);

  const dailyData = useMemo(() => {
    const map = {};
    trades.forEach(t => {
      const d = t.close_time || t.created_at;
      if (!d) return;
      const key = format(new Date(d), "yyyy-MM-dd");
      if (!map[key]) map[key] = { pnl: 0, trades: 0, wins: 0 };
      map[key].pnl += (t.net_pnl || t.pnl || 0);
      map[key].trades++;
      if ((t.pnl || 0) > 0) map[key].wins++;
    });
    return map;
  }, [trades]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPad = getDay(monthStart);

  const monthPnl = useMemo(() => days.reduce((sum, day) => {
    const key = format(day, "yyyy-MM-dd");
    return sum + (dailyData[key]?.pnl || 0);
  }, 0), [days, dailyData]);

  // Month stats for stat tiles
  const monthStats = useMemo(() => {
    if (!monthTrades.length) return null;
    const wins = monthTrades.filter(t => (t.pnl || 0) > 0);
    const winRate = (wins.length / monthTrades.length) * 100;

    const byDay = {};
    monthTrades.forEach(t => {
      const key = format(new Date(t.close_time || t.created_at), "yyyy-MM-dd");
      if (!byDay[key]) byDay[key] = { pnl: 0 };
      byDay[key].pnl += t.net_pnl || t.pnl || 0;
    });
    const dayPnls = Object.entries(byDay).map(([date, d]) => ({ date, pnl: d.pnl }));
    const activeDays = dayPnls.length;
    const bestDay = dayPnls.reduce((b, d) => d.pnl > b.pnl ? d : b, dayPnls[0]);
    const worstDay = dayPnls.reduce((w, d) => d.pnl < w.pnl ? d : w, dayPnls[0]);

    const sorted = dayPnls.sort((a, b) => new Date(a.date) - new Date(b.date));
    let maxStreak = 0, cur = 0;
    sorted.forEach(d => { if (d.pnl > 0) { cur++; if (cur > maxStreak) maxStreak = cur; } else cur = 0; });

    return { winRate, activeDays, bestDayPnl: bestDay?.pnl ?? 0, worstDayPnl: worstDay?.pnl ?? 0, maxStreak };
  }, [monthTrades]);

  const selectedDayTrades = useMemo(() => {
    if (!selectedDate) return [];
    const key = format(selectedDate, "yyyy-MM-dd");
    return trades.filter(t => {
      const d = t.close_time || t.created_at;
      return d && format(new Date(d), "yyyy-MM-dd") === key;
    });
  }, [selectedDate, trades]);

  const fmt = (v) => {
    const abs = Math.abs(v);
    const sign = v >= 0 ? "+" : "-";
    return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const calStatDefs = {
    stat_month_pnl:   { label: "Month P&L",    value: fmt(monthPnl),                       variant: monthPnl >= 0 ? "profit" : "loss",         icon: DollarSign },
    stat_winrate:     { label: "Win Rate",      value: `${(monthStats?.winRate ?? 0).toFixed(1)}%`, variant: (monthStats?.winRate ?? 0) >= 50 ? "profit" : "loss", icon: Target },
    stat_streak:      { label: "Win Streak",    value: `${monthStats?.maxStreak ?? 0}`,     icon: Zap },
    stat_best_day:    { label: "Best Day",      value: fmt(monthStats?.bestDayPnl ?? 0),    variant: "profit", icon: TrendingUp },
    stat_worst_day:   { label: "Worst Day",     value: fmt(monthStats?.worstDayPnl ?? 0),   variant: "loss",   icon: TrendingDown },
    stat_active_days: { label: "Active Days",   value: monthStats?.activeDays ?? 0,         icon: Calendar },
    stat_trades:      { label: "Month Trades",  value: monthTrades.length,                  icon: BarChart3 },
  };

  const removeWidget = (id) => saveBelowLayout(belowLayout.filter(w => w !== id));
  const addWidget = (id) => { if (!belowLayout.includes(id)) saveBelowLayout([...belowLayout, id]); };
  const doneEditing = () => { setIsEditing(false); setShowAddSidebar(false); };

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const nl = Array.from(belowLayout);
    const [r] = nl.splice(result.source.index, 1);
    nl.splice(result.destination.index, 0, r);
    saveBelowLayout(nl);
  };

  const renderBelowWidget = (id) => {
    if (CAL_STAT_IDS.has(id)) {
      const def = calStatDefs[id];
      if (!def) return null;
      return <StatCard label={def.label} value={def.value} variant={def.variant} icon={def.icon} />;
    }
    if (id === "cal_month_stats")    return <CalendarMonthStats trades={trades} currentMonth={currentMonth} />;
    if (id === "top_symbols")        return <CalendarTopSymbols trades={trades} currentMonth={currentMonth} />;
    if (id === "equity_curve")       return <EquityCurve trades={trades} startingBalance={startingBalance} />;
    if (id === "profit_chart")       return <ProfitChart trades={trades} />;
    if (id === "win_loss_dist")      return <WinLossDistribution trades={trades} />;
    if (id === "session_analysis")   return <SessionAnalysis trades={trades} />;
    if (id === "strategy_breakdown") return <StrategyBreakdown trades={trades} />;
    if (id === "cal_stats")          return <CalendarMonthStats trades={trades} currentMonth={currentMonth} />;
    return null;
  };

  // Group consecutive stat tiles for grid layout
  const STAT_IDS_SET = CAL_STAT_IDS;
  const renderItems = [];
  let statBuf = [];
  const flushStats = () => {
    if (statBuf.length) { renderItems.push({ type: "stats", items: [...statBuf] }); statBuf = []; }
  };
  belowLayout.forEach(id => {
    if (STAT_IDS_SET.has(id)) statBuf.push(id);
    else { flushStats(); renderItems.push({ type: "widget", id }); }
  });
  flushStats();

  return (
    <div className={cn("space-y-6 max-w-7xl transition-all duration-200", showAddSidebar && "mr-80")}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Profit Calendar</h1>
          <p className="text-sm text-muted-foreground mt-1">Visual daily performance overview</p>
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
          <span>Drag to reorder panels below the calendar — hover to reveal handles.</span>
        </div>
      )}

      {/* Calendar + Day Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-card rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-heading font-semibold text-foreground">
                {format(currentMonth, "MMMM yyyy")}
              </h2>
              <p className={cn("text-sm font-mono font-medium", monthPnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                {monthPnl >= 0 ? "+" : "-"}${Math.abs(monthPnl).toFixed(2)}
              </p>
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setCurrentMonth(new Date())}>
                Today
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {dayNames.map(d => (
              <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array(startPad).fill(null).map((_, i) => <div key={`pad-${i}`} />)}
            {days.map(day => {
              const key = format(day, "yyyy-MM-dd");
              const data = dailyData[key];
              const isSelected = selectedDate && isSameDay(day, selectedDate);
              const today = isToday(day);

              return (
                <button
                  key={key}
                  onClick={() => setSelectedDate(day)}
                  className={cn(
                    "aspect-square rounded-lg p-1 flex flex-col items-center justify-center transition-all relative",
                    isSelected && "ring-2 ring-primary",
                    today && !isSelected && "ring-1 ring-muted-foreground/30",
                    data
                      ? (data.pnl > 0 ? "bg-emerald-400/10 hover:bg-emerald-400/20" : data.pnl < 0 ? "bg-red-400/10 hover:bg-red-400/20" : "bg-secondary/50 hover:bg-secondary")
                      : "hover:bg-secondary/30"
                  )}
                >
                  <span className={cn("text-xs", today ? "font-bold text-primary" : "text-muted-foreground")}>
                    {format(day, "d")}
                  </span>
                  {data && (
                    <span className={cn(
                      "text-[10px] font-mono font-semibold",
                      data.pnl > 0 ? "text-emerald-400" : data.pnl < 0 ? "text-red-400" : "text-muted-foreground"
                    )}>
                      {data.pnl > 0 ? "+" : data.pnl < 0 ? "-" : ""}${Math.abs(data.pnl).toFixed(0)}
                    </span>
                  )}
                  {data && <span className="text-[9px] text-muted-foreground/70">{data.trades}t</span>}
                </button>
              );
            })}
          </div>
        </div>

        <CalendarDayDetail date={selectedDate} trades={selectedDayTrades} />
      </div>

      {/* Below-calendar widgets — DnD */}
      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="calendar_below">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-4">
              {renderItems.map((item, idx) => {
                if (item.type === "stats") {
                  // Stats group — render as a grid, drag as a block
                  const groupId = "stats_" + item.items.join("_");
                  const firstId = item.items[0];
                  return (
                    <Draggable key={groupId} draggableId={groupId} index={idx} isDragDisabled={!isEditing}>
                      {(drag, snap) => (
                        <div ref={drag.innerRef} {...drag.draggableProps} className={cn(snap.isDragging && "opacity-80 z-50")}>
                          <div className="relative group/statsrow">
                            {isEditing && (
                              <div {...drag.dragHandleProps} className="absolute -top-1 left-1/2 -translate-x-1/2 z-10 px-3 py-1 rounded-full bg-secondary/90 border border-border flex items-center gap-1 opacity-0 group-hover/statsrow:opacity-100 transition-opacity cursor-grab">
                                <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
                                <span className="text-[10px] text-muted-foreground">Drag stat row</span>
                              </div>
                            )}
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                              {item.items.map(id => {
                                const def = calStatDefs[id];
                                if (!def) return null;
                                return (
                                  <div key={id} className="relative group/stat">
                                    {isEditing && (
                                      <button onClick={() => removeWidget(id)} className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center shadow-md hover:scale-110 transition-transform opacity-0 group-hover/stat:opacity-100">
                                        <span className="text-[10px] font-bold leading-none">−</span>
                                      </button>
                                    )}
                                    <StatCard label={def.label} value={def.value} variant={def.variant} icon={def.icon} />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  );
                }

                const { id } = item;
                const content = renderBelowWidget(id);
                if (!content) return null;

                return (
                  <Draggable key={id} draggableId={id} index={idx} isDragDisabled={!isEditing}>
                    {(drag, snap) => (
                      <div ref={drag.innerRef} {...drag.draggableProps} className={cn("relative group/widget", snap.isDragging && "opacity-80 z-50")}>
                        {isEditing && (
                          <>
                            <div {...drag.dragHandleProps} className="absolute top-3 left-3 z-10 w-7 h-7 rounded-md bg-secondary/90 border border-border flex items-center justify-center opacity-0 group-hover/widget:opacity-100 transition-opacity cursor-grab">
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

      {showAddSidebar && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={() => setShowAddSidebar(false)} />
          <AddCalendarWidgetSidebar
            activeWidgets={belowLayout}
            onAdd={addWidget}
            onClose={() => setShowAddSidebar(false)}
          />
        </>
      )}
    </div>
  );
}
