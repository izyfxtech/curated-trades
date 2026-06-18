import React from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

export default function StatCard({ label, value, change, icon: Icon, variant = "default" }) {
  const isPositive = change && parseFloat(change) > 0;

  return (
    <div className={cn(
      "relative bg-card rounded-xl border border-border p-3 md:p-5 hover:border-primary/40 transition-all duration-300 group overflow-hidden",
      variant === "profit" && "hover:border-emerald-500/30",
      variant === "loss" && "hover:border-red-500/30",
    )}>
      {/* Accent glow top-left */}
      <div className={cn(
        "absolute top-0 left-0 w-24 h-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity",
        variant === "profit" ? "bg-emerald-400" : variant === "loss" ? "bg-red-400" : "bg-primary"
      )} />
      <div className="flex items-start justify-between mb-2 md:mb-3">
        <span className="text-[10px] md:text-xs font-medium text-muted-foreground uppercase tracking-wider leading-tight">{label}</span>
        {Icon && (
          <div className={cn(
            "w-7 h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-colors flex-shrink-0 ml-1",
            variant === "profit" ? "bg-emerald-500/10 group-hover:bg-emerald-500/20" :
            variant === "loss" ? "bg-red-500/10 group-hover:bg-red-500/20" :
            "bg-primary/10 group-hover:bg-primary/20"
          )}>
            <Icon className={cn(
              "w-3.5 h-3.5 md:w-4 md:h-4",
              variant === "profit" ? "text-emerald-400" :
              variant === "loss" ? "text-red-400" :
              "text-primary"
            )} />
          </div>
        )}
      </div>
      <div className="flex items-end gap-2 min-w-0">
        <span className={cn(
          "text-lg md:text-2xl font-bold font-mono tracking-tight truncate",
          variant === "profit" && "text-emerald-400",
          variant === "loss" && "text-red-400",
          variant === "default" && "text-foreground"
        )}>
          {value}
        </span>
        {change && (
          <span className={cn(
            "text-xs font-medium flex items-center gap-1 pb-1",
            isPositive ? "text-emerald-400" : "text-red-400"
          )}>
            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {change}
          </span>
        )}
      </div>
    </div>
  );
}
