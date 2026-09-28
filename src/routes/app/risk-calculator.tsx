// Standalone risk / position-size calculator ("/app/risk-calculator",
// Phase 1.5). Deliberately reuses calculateRiskPreview from trade-calc.ts —
// the exact same function the trade-logging modal uses for its pre-save
// preview — so "plan a trade here" and "the preview you see when logging a
// trade" can never silently drift into different math.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Calculator } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getWorkspace } from "@/lib/portfolios.functions";
import { calculateRiskPreview } from "@/lib/trade-calc";

export const Route = createFileRoute("/app/risk-calculator")({
  head: () => ({
    meta: [
      { title: "Risk calculator — Curated Trades" },
      { name: "description", content: "Work out position size, risk amount, and planned R:R before you enter a trade." },
    ],
  }),
  component: RiskCalculatorPage,
});

type Mode = "price" | "pips";

function RiskCalculatorPage() {
  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => getWorkspace() });
  const workspace = workspaceQuery.data;

  const [mode, setMode] = useState<Mode>("price");
  const [equity, setEquity] = useState("");
  const [riskPercent, setRiskPercent] = useState("");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [pipSize, setPipSize] = useState("0.0001");
  const [pipValue, setPipValue] = useState("10");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!workspace || initialized) return;
    // workspace.liveEquity (starting_equity + closed-trade P&L), not
    // activePortfolio.current_equity — that column is written once at
    // portfolio creation and never updated, so it goes stale the moment the
    // first trade closes. See DECISIONS.md #31.
    setEquity(String(workspace.liveEquity));
    setRiskPercent(String(workspace.activeAccount?.default_risk_percent ?? workspace.accounts[0]?.default_risk_percent ?? 1));
    setInitialized(true);
  }, [workspace, initialized]);

  const result = useMemo(() => {
    const equityNum = Number(equity);
    const riskNum = Number(riskPercent);
    const entryNum = Number(entry);
    const stopNum = Number(stop);
    const targetNum = target === "" ? null : Number(target);
    const pipSizeNum = Number(pipSize);
    const pipValueNum = Number(pipValue);

    const inputsValid =
      Number.isFinite(equityNum) && equityNum > 0 &&
      Number.isFinite(riskNum) && riskNum > 0 &&
      Number.isFinite(entryNum) && entryNum > 0 &&
      Number.isFinite(stopNum) && stopNum > 0 &&
      entryNum !== stopNum;

    if (!inputsValid) return null;

    const preview = calculateRiskPreview({
      equity: equityNum,
      riskPercent: riskNum,
      entryPrice: entryNum,
      stopLoss: stopNum,
    });

    const plannedR =
      targetNum != null && Number.isFinite(targetNum) && preview.stopDistance > 0
        ? Math.abs(targetNum - entryNum) / preview.stopDistance
        : null;

    if (mode === "price") {
      return {
        riskAmount: preview.riskAmount,
        stopDistance: preview.stopDistance,
        quantity: preview.suggestedQuantity,
        plannedR,
        lots: null as number | null,
        units: null as number | null,
      };
    }

    const pipsValid = Number.isFinite(pipSizeNum) && pipSizeNum > 0 && Number.isFinite(pipValueNum) && pipValueNum > 0;
    if (!pipsValid) return null;

    const stopPips = preview.stopDistance / pipSizeNum;
    const lots = stopPips > 0 ? preview.riskAmount / (stopPips * pipValueNum) : null;

    return {
      riskAmount: preview.riskAmount,
      stopDistance: preview.stopDistance,
      quantity: null as number | null,
      plannedR,
      lots,
      units: lots != null ? lots * 100000 : null,
    };
  }, [equity, riskPercent, entry, stop, target, pipSize, pipValue, mode]);

  return (
    <>
      <section className="mb-6 border-b border-border pb-5">
        <h1 className="page-title">Risk calculator</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Work out position size from your account equity and risk tolerance — independent of logging a trade. This
          is the same calculation used for the risk preview when you log a trade.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <div className="surface-panel space-y-5">
          <div className="direction-toggle">
            <Button type="button" variant={mode === "price" ? "secondary" : "ghost"} className="flex-1" onClick={() => setMode("price")}>
              Price-based
            </Button>
            <Button type="button" variant={mode === "pips" ? "secondary" : "ghost"} className="flex-1" onClick={() => setMode("pips")}>
              Forex (pips)
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {mode === "price"
              ? "For crypto, stocks, or any instrument where P&L is quantity × price move."
              : "For forex pairs sized in lots, where P&L is lots × pip value × pips moved."}
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="rc-equity" className="field-label">
                Account equity ($)
              </label>
              <Input id="rc-equity" type="number" step="any" className="font-mono" value={equity} onChange={(e) => setEquity(e.target.value)} />
            </div>
            <div>
              <label htmlFor="rc-risk" className="field-label">
                Risk per trade (%)
              </label>
              <Input id="rc-risk" type="number" step="any" className="font-mono" value={riskPercent} onChange={(e) => setRiskPercent(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="rc-entry" className="field-label">
                Entry price
              </label>
              <Input id="rc-entry" type="number" step="any" className="font-mono" value={entry} onChange={(e) => setEntry(e.target.value)} />
            </div>
            <div>
              <label htmlFor="rc-stop" className="field-label">
                Stop loss
              </label>
              <Input id="rc-stop" type="number" step="any" className="font-mono" value={stop} onChange={(e) => setStop(e.target.value)} />
            </div>
            <div>
              <label htmlFor="rc-target" className="field-label">
                Take profit
              </label>
              <Input id="rc-target" type="number" step="any" className="font-mono" placeholder="Optional" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
          </div>

          {mode === "pips" && (
            <div className="grid grid-cols-2 gap-4 border-t border-border pt-5">
              <div>
                <label htmlFor="rc-pip-size" className="field-label">
                  Pip size
                </label>
                <Input id="rc-pip-size" type="number" step="any" className="font-mono" value={pipSize} onChange={(e) => setPipSize(e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">0.0001 for most pairs, 0.01 for JPY pairs.</p>
              </div>
              <div>
                <label htmlFor="rc-pip-value" className="field-label">
                  Pip value per standard lot ($)
                </label>
                <Input id="rc-pip-value" type="number" step="any" className="font-mono" value={pipValue} onChange={(e) => setPipValue(e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">≈$10 for most USD-quoted majors at 1.0 lot.</p>
              </div>
            </div>
          )}
        </div>

        <div className="surface-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Result</p>
              <h2 className="panel-title">Suggested size</h2>
            </div>
            <Calculator className="size-5 text-chart-2" />
          </div>

          {result ? (
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Risk amount</dt>
                <dd className="font-mono font-semibold">${result.riskAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Stop distance</dt>
                <dd className="font-mono">{result.stopDistance.toLocaleString(undefined, { maximumFractionDigits: 5 })}</dd>
              </div>
              {mode === "price" ? (
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Suggested quantity</dt>
                  <dd className="font-mono font-semibold text-chart-2">
                    {result.quantity != null ? result.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"}
                  </dd>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Suggested lots</dt>
                    <dd className="font-mono font-semibold text-chart-2">
                      {result.lots != null ? result.lots.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Units</dt>
                    <dd className="font-mono">
                      {result.units != null ? Math.round(result.units).toLocaleString() : "—"}
                    </dd>
                  </div>
                </>
              )}
              {result.plannedR != null && (
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <dt className="text-muted-foreground">Planned R:R</dt>
                  <dd className="font-mono font-semibold">{result.plannedR.toFixed(2)}R</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Enter equity, risk %, entry, and stop to see suggested size.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
