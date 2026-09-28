// Shared between the Dashboard's compact curve and Analytics' larger one so
// "hover for details, click to open the trade's breakdown page" only has to
// be built once. Every point past the starting-equity anchor is
// interactive — hover shows a rich tooltip (not the browser's plain native
// title), click navigates to /app/journal/$tradeId, a real page separate
// from the edit modal (see that route for the "why a separate page"
// reasoning).
import { useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { useState } from "react";

import type { EquityCurvePoint } from "@/lib/equity-curve";

export interface EquityCurveChartProps {
  points: EquityCurvePoint[];
  polyline: string;
  labels: string[];
  width: number;
  height: number;
}

export function EquityCurveChart({ points, polyline, labels, width, height }: EquityCurveChartProps) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<EquityCurvePoint | null>(null);
  const lastIndex = points.length - 1;

  return (
    <div className="chart-area" aria-label="Equity curve">
      <div className="chart-y-labels">
        {labels.map((label, index) => (
          <span key={index}>{label}</span>
        ))}
      </div>
      <div className="chart-plot">
        <div className="chart-grid-lines">
          <span />
          <span />
          <span />
          <span />
        </div>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="equity-svg"
          role="img"
          aria-label="Equity curve built from closed trades — hover a point for details, click to open that trade"
        >
          <polyline points={polyline} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" className="chart-line" />
          {points.map((point, index) => {
            const isLast = index === lastIndex;
            const clickable = point.tradeId != null;
            return (
              <circle
                key={`${point.tradeId ?? "start"}-${index}`}
                cx={point.x}
                cy={point.y}
                r={isLast ? 5 : 3}
                className={`${isLast ? "chart-end" : "chart-node"} ${clickable ? "chart-node-clickable" : ""}`}
                onMouseEnter={() => setHovered(point)}
                onMouseLeave={() => setHovered((current) => (current === point ? null : current))}
                onClick={
                  clickable
                    ? () => void navigate({ to: "/app/journal/$tradeId", params: { tradeId: point.tradeId! } })
                    : undefined
                }
              />
            );
          })}
        </svg>
        {hovered && (
          <div
            className="equity-tooltip"
            style={{
              left: `${(hovered.x / width) * 100}%`,
              top: `${(hovered.y / height) * 100}%`,
              transform: hovered.x / width > 0.6 ? "translate(-100%, -110%)" : "translate(0, -110%)",
            }}
          >
            <p className="font-mono text-[0.68rem] text-muted-foreground">{format(new Date(hovered.date), "MMM d, yyyy")}</p>
            {hovered.tradeId ? (
              <>
                <p className="text-sm font-semibold">{hovered.symbol}</p>
                <p className={`font-mono text-xs font-medium ${(hovered.netPnl ?? 0) >= 0 ? "text-chart-2" : "text-destructive"}`}>
                  {(hovered.netPnl ?? 0) >= 0 ? "+" : "−"}${Math.abs(hovered.netPnl ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </p>
                <p className="font-mono text-[0.68rem] text-muted-foreground">
                  balance ${hovered.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
                <p className="mt-1 text-[0.68rem] text-muted-foreground">Click to open</p>
              </>
            ) : (
              <p className="text-sm font-semibold">Starting equity</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
