"use client";

import { format, parseISO } from "date-fns";
import { CalendarDays } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function toDate(value: string): Date | undefined {
  if (!value) return undefined;
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toIso(date: Date | undefined): string {
  return date ? format(date, "yyyy-MM-dd") : "";
}

export interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  placeholder?: string;
  className?: string;
}

/** Range picker used everywhere a "from/to" date pair is needed (Journal filters, Reports share period). */
export function DateRangePicker({ from, to, onChange, placeholder = "Any date", className }: DateRangePickerProps) {
  const range: DateRange | undefined = from || to ? { from: toDate(from), to: toDate(to) } : undefined;

  const label =
    from && to
      ? `${format(toDate(from)!, "MMM d, yyyy")} – ${format(toDate(to)!, "MMM d, yyyy")}`
      : from
        ? `From ${format(toDate(from)!, "MMM d, yyyy")}`
        : to
          ? `Until ${format(toDate(to)!, "MMM d, yyyy")}`
          : placeholder;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("h-9 w-full justify-start gap-2 font-normal", !(from || to) && "text-muted-foreground", className)}
        >
          <CalendarDays className="size-4 shrink-0" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          defaultMonth={range?.from ?? new Date()}
          selected={range}
          onSelect={(next) => onChange({ from: toIso(next?.from), to: toIso(next?.to) })}
          numberOfMonths={2}
        />
        {(from || to) && (
          <div className="flex justify-end border-t border-border p-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ from: "", to: "" })}>
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
