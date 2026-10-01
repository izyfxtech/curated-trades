// A real calendar-aligned P&L heatmap — GitHub-contribution-graph style:
// weeks run left to right as columns, Monday through Sunday top to bottom
// within each column, with month labels above and weekday labels down the
// side. This replaces a version that was just `grid-cols-7` applied to the
// last 35 days in strict chronological order with no alignment at all — so
// "column 3" had no consistent meaning (it wasn't always Wednesday), there
// were no weekday/month labels to orient against, and the range was always
// exactly 35 days regardless of what date range the rest of the page was
// showing.
import { useState } from "react";
import { addDays, differenceInCalendarDays, format, isWithinInterval, startOfDay, startOfWeek } from "date-fns";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatSignedMoney } from "@/lib/money";

interface PnlHeatmapProps {
  /** Realized P&L per day, keyed by `yyyy-MM-dd` in local time. */
  pnlByDay: Map<string, number>;
  /** The date range currently selected elsewhere on the page — the heatmap
   * always shows exactly this range (padded out to full weeks), never a
   * hardcoded window of its own. */
  start: Date;
  end: Date;
  onSelectDay?: (iso: string) => void;
  currency?: string;
}

const WEEKDAY_ROW_LABELS: Record<number, string> = { 0: "Mon", 2: "Wed", 4: "Fri" };
// A year of daily cells is already a lot of DOM/SVG for a "how am I doing
// lately" widget, and beyond this the per-cell width rounds down to
// illegible. Long "All time" ranges show the most recent year instead of
// growing forever.
const MAX_DAYS = 371;

export function PnlHeatmap({ pnlByDay, start, end, onSelectDay, currency = "USD" }: PnlHeatmapProps) {
  const [hoveredIso, setHoveredIso] = useState<string | null>(null);

  const { weeks, monthLabels, maxAbsPnl, clampedStart } = (() => {
    const rangeEnd = startOfDay(end);
    const rawStart = startOfDay(start);
    const cappedStart =
      differenceInCalendarDays(rangeEnd, rawStart) > MAX_DAYS ? addDays(rangeEnd, -MAX_DAYS) : rawStart;

    const gridStart = startOfWeek(cappedStart, { weekStartsOn: 1 });
    const gridEnd = startOfWeek(rangeEnd, { weekStartsOn: 1 });
    const totalWeeks = differenceInCalendarDays(gridEnd, gridStart) / 7 + 1;

    const weeks: { date: Date; iso: string; pnl: number | null; inRange: boolean }[][] = [];
    let maxAbsPnl = 1;
    let lastMonth = -1;
    const monthLabels: { week: number; label: string }[] = [];

    for (let w = 0; w < totalWeeks; w++) {
      const week: (typeof weeks)[number] = [];
      for (let d = 0; d < 7; d++) {
        const date = addDays(gridStart, w * 7 + d);
        const iso = format(date, "yyyy-MM-dd");
        const inRange = isWithinInterval(date, { start: cappedStart, end: rangeEnd });
        const pnl = inRange ? (pnlByDay.get(iso) ?? null) : null;
        if (pnl != null) maxAbsPnl = Math.max(maxAbsPnl, Math.abs(pnl));
        week.push({ date, iso, pnl, inRange });
      }
      weeks.push(week);
      const firstDayOfWeek = week[0];
      if (!firstDayOfWeek) continue;
      const firstOfWeekMonth = firstDayOfWeek.date.getMonth();
      if (firstOfWeekMonth !== lastMonth) {
        monthLabels.push({ week: w, label: format(firstDayOfWeek.date, "MMM") });
        lastMonth = firstOfWeekMonth;
      }
    }

    return { weeks, monthLabels, maxAbsPnl, clampedStart: cappedStart };
  })();

  const wasClamped = differenceInCalendarDays(startOfDay(end), startOfDay(start)) > MAX_DAYS;

  return (
    <div>
      {wasClamped && (
        <p className="mb-2 text-xs text-muted-foreground">
          Showing the most recent {format(clampedStart, "MMM d, yyyy")} – {format(end, "MMM d, yyyy")} (the full
          selected range is longer than one heatmap can usefully show).
        </p>
      )}
      <div className="overflow-x-auto">
        <div className="inline-grid grid-cols-[auto_1fr] gap-x-2">
          <div />
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${weeks.length}, 0.75rem)` }}>
            {monthLabels.map(({ week, label }) => (
              <span
                key={`${week}-${label}`}
                className="text-[10px] text-muted-foreground"
                style={{ gridColumnStart: week + 1 }}
              >
                {label}
              </span>
            ))}
          </div>

          <div className="grid grid-rows-7 gap-1 pt-4 text-right">
            {Array.from({ length: 7 }, (_, row) => (
              <span key={row} className="h-3 text-[10px] leading-3 text-muted-foreground">
                {WEEKDAY_ROW_LABELS[row] ?? ""}
              </span>
            ))}
          </div>

          <div
            className="grid grid-flow-col grid-rows-7 gap-1 pt-4"
            style={{ gridTemplateColumns: `repeat(${weeks.length}, 0.75rem)` }}
          >
            {weeks.flat().map((day) => {
              if (!day.inRange) return <div key={day.iso} className="size-3" aria-hidden="true" />;

              const intensity = day.pnl == null ? 0 : Math.min(1, Math.abs(day.pnl) / maxAbsPnl);
              const bg =
                day.pnl == null
                  ? "var(--color-muted)"
                  : day.pnl >= 0
                    ? `oklch(0.44 0.1 150 / ${0.15 + intensity * 0.65})`
                    : `oklch(0.46 0.135 30 / ${0.15 + intensity * 0.65})`;

              return (
                <Tooltip key={day.iso} open={hoveredIso === day.iso} onOpenChange={(open) => setHoveredIso(open ? day.iso : null)}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled={day.pnl == null || !onSelectDay}
                      className="size-3 rounded-[2px] border border-border transition-transform enabled:cursor-pointer enabled:hover:scale-125"
                      style={{ backgroundColor: bg }}
                      onClick={() => onSelectDay?.(day.iso)}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    {format(day.date, "EEE, MMM d, yyyy")}
                    {" — "}
                    {day.pnl == null ? "no closed trades" : formatSignedMoney(day.pnl, currency)}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span>Loss</span>
        {[0.7, 0.45, 0.2].map((a) => (
          <span key={`loss-${a}`} className={cn("size-3 rounded-[2px] border border-border")} style={{ backgroundColor: `oklch(0.46 0.135 30 / ${a})` }} />
        ))}
        <span className="size-3 rounded-[2px] border border-border" style={{ backgroundColor: "var(--color-muted)" }} />
        {[0.2, 0.45, 0.7].map((a) => (
          <span key={`profit-${a}`} className={cn("size-3 rounded-[2px] border border-border")} style={{ backgroundColor: `oklch(0.44 0.1 150 / ${a})` }} />
        ))}
        <span>Profit</span>
      </div>
    </div>
  );
}
