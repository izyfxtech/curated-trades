// Standalone risk / position-size calculator ("/app/risk-calculator").
// Reuses calculateRiskPreview and the instrument specs from instruments.ts —
// the exact same functions the trade-logging modal uses for its pre-save
// preview — so "plan a trade here" and "the preview you see when logging a
// trade" can never silently drift into different math. Sizing is in lots for
// forex/metals and plain units for anything else, same rule as everywhere
// else in the app (see instruments.ts).
//
// The inputs are a TanStack Form whose defaults come from the workspace the
// route loader has already fetched (no "initialize once" effect), and the
// result is computed straight from the live form values.
import { useSuspenseQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { Calculator } from "lucide-react";

import { InstrumentSelect } from "@/components/journal/InstrumentSelect";
import { formProps, useAppForm } from "@/lib/form";
import { buildSizingContext, getInstrumentSpec, needsQuoteRate, sizeLabel } from "@/lib/instruments";
import { workspaceQueryOptions } from "@/lib/queries";
import { calculateRiskPreview } from "@/lib/trade-calc";

export const Route = createFileRoute("/app/risk-calculator")({
  head: () => ({
    meta: [
      { title: "Risk calculator — Curated Trades" },
      { name: "description", content: "Work out position size in lots, risk amount, and planned R:R before you enter a trade." },
    ],
  }),
  // Already cached by the /app layout; this just makes the dependency explicit
  // so the form below can seed itself synchronously.
  loader: ({ context }) => context.queryClient.ensureQueryData(workspaceQueryOptions),
  component: RiskCalculatorPage,
});

type CalcValues = {
  symbol: string;
  equity: string;
  riskPercent: string;
  entry: string;
  stop: string;
  target: string;
  quoteRate: string;
};

function RiskCalculatorPage() {
  const { data: workspace } = useSuspenseQuery(workspaceQueryOptions);

  const form = useAppForm({
    defaultValues: {
      symbol: "EURUSD",
      // workspace.liveEquity (starting_equity + closed-trade P&L), not
      // activePortfolio.current_equity — that column is written once at
      // portfolio creation and never updated, so it goes stale the moment the
      // first trade closes. See DECISIONS.md #31.
      equity: String(workspace.liveEquity),
      riskPercent: String(workspace.activeAccount?.default_risk_percent ?? workspace.accounts[0]?.default_risk_percent ?? 1),
      entry: "",
      stop: "",
      target: "",
      quoteRate: "",
    } as CalcValues,
  });
  const values = useStore(form.store, (state) => state.values);

  const accountCurrency = (workspace.activeAccount?.base_currency ?? workspace.accounts[0]?.base_currency ?? "USD").toUpperCase();
  const spec = getInstrumentSpec(values.symbol || "EURUSD");
  const sizeText = sizeLabel(spec);
  const askForQuoteRate = values.symbol.trim() !== "" && needsQuoteRate(spec, accountCurrency);
  const quoteRateNum = values.quoteRate !== "" ? Number(values.quoteRate) : null;

  const result = (() => {
    const equityNum = Number(values.equity);
    const riskNum = Number(values.riskPercent);
    const entryNum = Number(values.entry);
    const stopNum = Number(values.stop);
    const targetNum = values.target === "" ? null : Number(values.target);

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
        sizing = buildSizingContext({ symbol: values.symbol, accountCurrency, quoteRate: quoteRateNum });
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
  })();

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
        <form {...formProps(form)} className="surface-panel space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <form.AppField name="symbol">
              {(field) => (
                <div>
                  <label htmlFor="rc-symbol" className="field-label">
                    Instrument
                  </label>
                  <InstrumentSelect id="rc-symbol" value={field.state.value} onChange={field.handleChange} />
                </div>
              )}
            </form.AppField>
            <form.AppField name="equity">
              {(field) => <field.TextField id="rc-equity" label={`Account equity (${accountCurrency})`} type="number" step="any" className="font-mono" />}
            </form.AppField>
          </div>

          <form.AppField name="riskPercent">
            {(field) => <field.TextField id="rc-risk" label="Risk per trade (%)" type="number" step="any" className="max-w-40 font-mono" />}
          </form.AppField>

          <div className="grid grid-cols-3 gap-4">
            <form.AppField name="entry">
              {(field) => <field.TextField id="rc-entry" label="Entry price" type="number" step="any" className="font-mono" />}
            </form.AppField>
            <form.AppField name="stop">
              {(field) => <field.TextField id="rc-stop" label="Stop loss" type="number" step="any" className="font-mono" />}
            </form.AppField>
            <form.AppField name="target">
              {(field) => <field.TextField id="rc-target" label="Take profit" type="number" step="any" className="font-mono" placeholder="Optional" />}
            </form.AppField>
          </div>

          {askForQuoteRate && (
            <div className="border-t border-border pt-5">
              <form.AppField name="quoteRate">
                {(field) => (
                  <field.TextField
                    id="rc-quote-rate"
                    label={`${accountCurrency} value of 1 ${spec.quote}`}
                    type="number"
                    step="any"
                    className="max-w-40 font-mono"
                    placeholder={spec.quote === "JPY" ? "0.0067" : "1.27"}
                    hint={`${spec.symbol} is priced in ${spec.quote}, not ${accountCurrency} — this converts the result.`}
                  />
                )}
              </form.AppField>
            </div>
          )}
        </form>

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
