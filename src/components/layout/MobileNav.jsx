import React from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, BookOpen, BarChart3, Calendar, Target, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { TrendingUp } from "lucide-react";

const tabs = [
  { icon: LayoutDashboard, label: "Home", path: "/dashboard" },
  { icon: BookOpen, label: "Trades", path: "/trades" },
  { icon: BarChart3, label: "Analytics", path: "/analytics" },
  { icon: Calendar, label: "Calendar", path: "/calendar" },
  { icon: Target, label: "Strategies", path: "/strategies" },
];

export default function MobileNav() {
  const location = useLocation();

  return (
    <>
      {/* Top bar */}
      <div className="fixed top-0 left-0 right-0 h-16 bg-card border-b border-border flex items-center justify-between px-4 z-40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-heading font-bold text-foreground">CuratedTrades</span>
        </div>
      </div>

      {/* Bottom tabs */}
      <div className="fixed bottom-0 left-0 right-0 h-16 bg-card border-t border-border flex items-center justify-around z-40 md:hidden">
        {tabs.map((tab) => {
          const isActive = location.pathname === tab.path;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-all",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <tab.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
