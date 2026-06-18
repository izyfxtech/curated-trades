import React from "react";
import { Link } from "react-router-dom";
import { TrendingUp } from "lucide-react";

export default function AuthLayout({ icon: Icon, title, subtitle, footer, children }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top logo bar */}
      <div className="flex items-center gap-2.5 px-6 py-4 border-b border-border">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-heading font-bold text-base text-foreground">CuratedTrades</span>
        </Link>
      </div>

      {/* Centered card area */}
      <div className="flex-1 flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-5">
              <Icon className="w-7 h-7 text-primary-foreground" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
            {subtitle && <p className="text-muted-foreground mt-2 text-sm">{subtitle}</p>}
          </div>

          {/* Card */}
          <div className="bg-card rounded-2xl shadow-sm border border-border px-8 py-8">
            {children}
          </div>

          {/* Footer link */}
          {footer && (
            <p className="text-center text-sm text-muted-foreground mt-6 pb-6">{footer}</p>
          )}
        </div>
      </div>
    </div>
  );
}
