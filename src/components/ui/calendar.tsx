"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type DayPickerProps } from "react-day-picker";

import { cn } from "@/lib/utils";

export type CalendarProps = DayPickerProps;

/**
 * "Today" is a dashed primary-colored border, not a filled dot — same
 * convention as .streak-dot.today in styles.css, so "this is the current
 * day" reads identically wherever it shows up in the app.
 */
function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-4",
        month: "flex flex-col gap-3",
        month_caption: "flex justify-center pt-1 pb-2 relative items-center",
        caption_label: "text-sm font-medium",
        nav: "flex items-center gap-1 absolute inset-x-1 top-1 justify-between",
        button_previous: cn(
          "inline-flex size-7 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground disabled:opacity-30",
        ),
        button_next: cn(
          "inline-flex size-7 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground disabled:opacity-30",
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-9 text-center font-mono text-[0.7rem] font-normal text-muted-foreground",
        week: "flex w-full mt-1",
        day: "size-9 p-0 text-center text-sm relative [&:has([data-selected])]:bg-accent first:[&:has([data-selected])]:rounded-l-md last:[&:has([data-selected])]:rounded-r-md",
        day_button: cn(
          "size-9 rounded-md p-0 font-mono font-normal text-foreground hover:bg-accent hover:text-accent-foreground aria-selected:opacity-100",
        ),
        range_start: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary rounded-l-md",
        range_end: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary rounded-r-md",
        range_middle: "[&>button]:bg-transparent [&>button]:text-foreground",
        selected: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
        today: "[&>button]:border [&>button]:border-dashed [&>button]:border-primary",
        outside: "text-muted-foreground/40 aria-selected:text-muted-foreground",
        disabled: "text-muted-foreground/40 opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...chevronProps }) =>
          orientation === "left" ? (
            <ChevronLeft className="size-4" {...chevronProps} />
          ) : (
            <ChevronRight className="size-4" {...chevronProps} />
          ),
      }}
      {...props}
    />
  );
}

export { Calendar };
