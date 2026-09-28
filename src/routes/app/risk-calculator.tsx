// Standalone risk / position-size calculator ("/app/risk-calculator").
// Reuses calculateRiskPreview and the instrument specs from instruments.ts —
// the exact same functions the trade-logging modal uses for its pre-save
// preview — so "plan a trade here" and "the preview you see when logging a
// trade" can never silently drift into different math. Sizing is in lots for
// forex/metals and plain units for anything else, same rule as everywhere
// else in the app (see instruments.ts).
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Calculator } from "lucide-react";

import { Input } from "@/components/ui/input";
import { getWorkspace } from "@/lib/portfolios.functions";
import { calculateRiskPreview } from "@/lib/trade-calc";
import { buildSizingContext, getInstrumentSpec, needsQuoteRate, sizeLabel } from "@/lib/instruments";

export const Route = createFileRoute("/app/risk-calculator")({
  head: () => ({
    meta: [
      { title: "Risk calculator — Curated Trades" },
      { name: "description", content: "Work out position size in lots, risk amount, and planned R:R before you enter a trade." },
    ],
  }),
  component: RiskCalculatorPage,
});

function RiskCalculatorPage() {
  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => getWorkspace() });
  const workspace = workspaceQuery.data;

  const [symbol, setSymbol] = useState("EURUSD");
  const [equity, setEquity] = useState("");
  const [riskPercent, setRiskPercent] = useState("");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [quoteRate, setQuoteRate] = useState("");
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

  const accountCurrency = (workspace?.activeAccount?.base_currency ?? workspace?.accounts[0]?.base_currency ?? "USD").toUpperCase();
  const spec = getInstrumentSpec(symbol || "EURUSD");
  const sizeText = sizeLabel(spec);
  const askForQuoteRate = symbol.trim() !== "" && needsQuoteRate(spec, accountCurrency);
  const quoteRateNum = quoteRate !== "" ? Number(quoteRate) : null;

  const result = useMemo(() => {
    const equityNum = Number(equity);
    const riskNum = Number(riskPercent);
    const entryNum = Number(entry);
    const stopNum = Number(stop);
    const targetNum = target === "" ? null : Number(target);

    const inputsValid =
      Number.isFinite(equityNum) && equityNum > 0 &&
      Number.isFinite(riskNum) && riskNum > 0 &&
      Number.isFinite(entryNum) && entryNum > 0 &&
      Number.isFinite(stopNum) && stopNum > 0 &&
      entryNum !== stopNum;

    if (!inputsValid) return null;

    let sizing;
    if (spec.sizeUnit === "lots") {
      try {
        sizing = buildSizingContext({ symbol, accountCurrency, quoteRate: quoteRateNum });
      } catch {
        return null; // cross pair, rate not entered yet — the field below asks for it
      }
    }

    const preview = calculateRiskPreview({
      equity: equityNum,
      riskPercent: riskNum,
      entryPrice: entryNum,
      stopLoss: stopNum,
      ...(sizing ? { sizing } : {}),
    });

    const plannedR =
      targetNum != null && Number.isFinite(targetNum) && preview.stopDistance > 0
        ? Math.abs(targetNum - entryNum) / preview.stopDistance
        : null;

    return { preview, plannedR };
  }, [equity, riskPercent, entry, stop, target, symbol, accountCurrency, quoteRateNum, spec.sizeUnit]);

  return (
    <>
      <section className="mb-6 border-b border-border pb-5">
        <h1 className="page-title">Risk calculator</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Work out position size in lots from your account equity and risk tolerance — independent of logging a
          trade. This is the same calculation used for the risk preview when you log a trade.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <div className="surface-panel space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="rc-symbol" className="field-label">
                Instrument
              </label>
              <Input
                id="rc-symbol"
                className="font-mono uppercase"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="EURUSD"
              />
            </div>
            <div>
              <label htmlFor="rc-equity" className="field-label">
                Account equity ({accountCurrency})
              </label>
              <Input id="rc-equity" type="number" step="any" className="font-mono" value={equity} onChange={(e) => setEquity(e.target.value)} />
            </div>
          </div>

          <div>
            <label htmlFor="rc-risk" className="field-label">
              Risk per trade (%)
            </label>
            <Input id="rc-risk" type="number" step="any" className="font-mono max-w-40" value={riskPercent} onChange={(e) => setRiskPercent(e.target.value)} />
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

          {askForQuoteRate && (
            <div className="border-t border-border pt-5">
              <label htmlFor="rc-quote-rate" className="field-label">
                {accountCurrency} value of 1 {spec.quote}
              </label>
              <Input
                id="rc-quote-rate"
                type="number"
                step="any"
                className="font-mono max-w-40"
                value={quoteRate}
                onChange={(e) => setQuoteRate(e.target.value)}
                placeholder={spec.quote === "JPY" ? "0.0067" : "1.27"}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {spec.symbol} is priced in {spec.quote}, not {accountCurrency} — this converts the result.
              </p>
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
                <dd className="font-mono font-semibold">
                  {result.preview.riskAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {accountCurrency}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Stop distance</dt>
                <dd className="font-mono">
                  {result.preview.stopDistance.toLocaleString(undefined, { maximumFractionDigits: 5 })}
                  {result.preview.stopPips != null && ` (${result.preview.stopPips.toLocaleString(undefined, { maximumFractionDigits: 1 })} pips)`}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Suggested size</dt>
                <dd className="font-mono font-semibold text-chart-2">
                  {result.preview.suggestedLotsRounded != null
                    ? `${result.preview.suggestedLotsRounded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${sizeText.unit}`
                    : result.preview.suggestedQuantity != null
                      ? `${result.preview.suggestedQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${sizeText.unit}`
                      : "—"}
                </dd>
              </div>
              {result.preview.riskAtRoundedSize != null && (
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Risk at that size</dt>
                  <dd className="font-mono">
                    {result.preview.riskAtRoundedSize.toLocaleString(undefined, { maximumFractionDigits: 2 })} {accountCurrency}
                  </dd>
                </div>
              )}
              {result.preview.pipValuePerLot != null && (
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Pip value / lot</dt>
                  <dd className="font-mono">
                    {result.preview.pipValuePerLot.toLocaleString(undefined, { maximumFractionDigits: 2 })} {accountCurrency}
                  </dd>
                </div>
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
              {askForQuoteRate && quoteRateNum == null
                ? `Enter the ${spec.quote}/${accountCurrency} rate above to see suggested size.`
                : "Enter the instrument, equity, risk %, entry, and stop to see suggested size."}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
