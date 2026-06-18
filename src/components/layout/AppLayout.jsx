import React, { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import MobileNav from "./MobileNav";
import { cn } from "@/lib/utils";

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem("ct_theme");
    return stored ? stored === "dark" : true; // default dark
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("ct_theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  return (
    <div className="min-h-screen bg-background relative">
      {/* Subtle grid background */}
      <div className="fixed inset-0 pointer-events-none z-0" style={{
        backgroundImage: `
          radial-gradient(ellipse at 20% 0%, hsl(var(--primary) / 0.07) 0%, transparent 60%),
          radial-gradient(ellipse at 80% 100%, hsl(var(--primary) / 0.05) 0%, transparent 50%)
        `
      }} />
      <div className="fixed inset-0 pointer-events-none z-0 opacity-[0.03]" style={{
        backgroundImage: `linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)`,
        backgroundSize: '40px 40px'
      }} />
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
          darkMode={darkMode}
          onToggleDark={() => setDarkMode(d => !d)}
        />
      </div>
      
      {/* Mobile nav */}
      <div className="md:hidden">
        <MobileNav />
      </div>

      {/* Main content */}
      <main className={cn(
        "transition-all duration-300 min-h-screen relative z-10",
        "md:ml-[240px]",
        collapsed && "md:ml-[68px]",
        "pt-16 md:pt-0"
      )}>
        <div className="p-4 md:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
