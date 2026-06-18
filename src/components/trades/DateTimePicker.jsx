import React, { useState, useRef, useEffect } from "react";
import { format, setHours, setMinutes } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export default function DateTimePicker({ value, onChange, label }) {
  const [step, setStep] = useState("date"); // "date" | "time"
  const [open, setOpen] = useState(false);
  const today = new Date();

  // Parse existing value
  const parsedDate = value ? new Date(value) : null;

  const [selectedDate, setSelectedDate] = useState(parsedDate || today);
  const [hours, setHoursState] = useState(parsedDate ? parsedDate.getHours() : today.getHours());
  const [minutes, setMinutesState] = useState(parsedDate ? parsedDate.getMinutes() : today.getMinutes());

  // Sync when value changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(value);
      setSelectedDate(d);
      setHoursState(d.getHours());
      setMinutesState(d.getMinutes());
    } else {
      const now = new Date();
      setSelectedDate(now);
      setHoursState(now.getHours());
      setMinutesState(now.getMinutes());
    }
  }, [value]);

  const handleDateSelect = (date) => {
    if (!date) return;
    // Block future dates
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    if (d > todayMidnight) return;
    setSelectedDate(date);
    setStep("time");
  };

  const handleConfirmTime = () => {
    const d = new Date(selectedDate);
    d.setHours(hours, minutes, 0, 0);
    onChange(d.toISOString().slice(0, 16));
    setOpen(false);
    setStep("date");
  };

  const handleOpenChange = (o) => {
    setOpen(o);
    if (o) setStep("date");
  };

  const displayValue = parsedDate
    ? format(parsedDate, "MMM d, yyyy  HH:mm")
    : null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button className={cn(
          "flex items-center gap-2 w-full px-3 h-9 rounded-md border text-sm transition-colors text-left",
          "bg-secondary/50 border-border hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-ring",
          !displayValue && "text-muted-foreground"
        )}>
          <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <span className="font-mono text-xs flex-1">
            {displayValue || `Select ${label || "date & time"}`}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0 bg-card border-border shadow-xl" align="start">
        {step === "date" ? (
          <div>
            <div className="px-4 pt-3 pb-1 border-b border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Select Date</p>
            </div>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
              defaultMonth={selectedDate}
              disabled={(date) => date > new Date()}
              className="rounded-none"
              classNames={{
                months: "p-3",
                day_selected: "bg-primary text-primary-foreground hover:bg-primary",
                day_today: "border border-primary/50 text-primary font-bold",
                day: "h-8 w-8 text-sm rounded-md hover:bg-secondary transition-colors",
                head_cell: "text-muted-foreground text-xs font-medium w-8",
                caption: "flex justify-center pt-1 relative items-center mb-2",
                caption_label: "text-sm font-semibold text-foreground",
                nav_button: "h-7 w-7 bg-transparent hover:bg-secondary rounded-md transition-colors",
                nav_button_previous: "absolute left-1",
                nav_button_next: "absolute right-1",
                table: "w-full border-collapse space-y-1",
                row: "flex w-full mt-1",
                cell: "text-center relative p-0",
              }}
            />
          </div>
        ) : (
          <div className="p-4 space-y-4 min-w-[220px]">
            <div className="flex items-center gap-2 border-b border-border pb-3 mb-1">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {format(selectedDate, "MMM d, yyyy")} — Set Time
              </p>
            </div>

            {/* Time display */}
            <div className="text-center font-mono text-3xl font-bold text-foreground tracking-widest">
              {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}
            </div>

            {/* Hours */}
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Hour</p>
              <div className="grid grid-cols-6 gap-1">
                {Array.from({ length: 24 }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setHoursState(i)}
                    className={cn(
                      "h-7 w-full rounded text-xs font-mono transition-colors",
                      hours === i
                        ? "bg-primary text-primary-foreground font-bold"
                        : "bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                  >
                    {String(i).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </div>

            {/* Minutes */}
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Minute</p>
              <div className="grid grid-cols-6 gap-1">
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                  <button
                    key={m}
                    onClick={() => setMinutesState(m)}
                    className={cn(
                      "h-7 w-full rounded text-xs font-mono transition-colors",
                      minutes === m
                        ? "bg-primary text-primary-foreground font-bold"
                        : "bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                  >
                    {String(m).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => setStep("date")}>
                ← Back
              </Button>
              <Button size="sm" className="flex-1 text-xs" onClick={handleConfirmTime}>
                Confirm
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
