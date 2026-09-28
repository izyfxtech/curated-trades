// Renders the InsightCard[] produced by generateInsights() in lib/analytics.ts.
// Note the inline style for the tone border color below: .surface-panel sets
// the full `border` shorthand in styles.css, which wins the CSS cascade over
// a Tailwind border-color utility class of equal specificity defined earlier
// in the stylesheet — a Tailwind class here would have silently done nothing.
import { AlertTriangle, TrendingUp } from "lucide-react";

import type { InsightCard } from "@/lib/analytics";

export function InsightCards({ insights }: { insights: InsightCard[] }) {
  if (insights.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {insights.map((insight) => (
        <div
          key={insight.id}
          className="surface-panel flex items-start gap-2.5"
          style={{
            borderColor:
              insight.tone === "warning"
                ? "color-mix(in oklab, var(--color-destructive) 35%, transparent)"
                : insight.tone === "positive"
                  ? "color-mix(in oklab, var(--color-chart-2) 35%, transparent)"
                  : undefined,
          }}
        >
          {insight.tone === "warning" ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          ) : (
            <TrendingUp className="mt-0.5 size-4 shrink-0 text-chart-2" />
          )}
          <p className="text-sm leading-snug">{insight.text}</p>
        </div>
      ))}
    </div>
  );
}
