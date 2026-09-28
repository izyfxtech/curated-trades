// CSV trade import modal. Supports a generic format (matching what Export
// CSV produces) plus broker/platform presets (MT4, cTrader, Bybit,
// TradingView) — see lib/import-presets.ts for the column-remapping logic.
// Binance and Coinbase are deliberately NOT one-click presets: those
// platforms export individual fills, not round-trip trades, and silently
// treating a fill as a complete trade would misstate P&L. The dropdown
// includes an entry that explains this rather than pretending to support it.
import { useMutation } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { normalizeImportRows, parseCsv, type ImportRowResult } from "@/lib/csv";
import { applyPreset, IMPORT_PRESETS, parseTradingViewTrades } from "@/lib/import-presets";
import { importTrades } from "@/lib/import.functions";
import type { Database } from "@/integrations/supabase/types";

type ImportBatchRow = Database["public"]["Tables"]["import_batches"]["Row"];

export function CsvImportModal({
  portfolioId,
  accountId,
  onClose,
  onImported,
}: {
  portfolioId: string;
  accountId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRowResult[] | null>(null);
  const [parseError, setParseError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [result, setResult] = useState<ImportBatchRow | null>(null);
  const [presetId, setPresetId] = useState("generic");
  const [defaultSymbol, setDefaultSymbol] = useState("");
  const [rawParsed, setRawParsed] = useState<{ header: string[]; dataRows: string[][] } | null>(null);
  const activePreset = IMPORT_PRESETS.find((p) => p.id === presetId) ?? IMPORT_PRESETS[0]!;

  const importMutation = useMutation({
    mutationFn: () => {
      const validRows = (rows ?? []).flatMap((row) => (row.normalized ? [row.normalized] : []));
      return importTrades({ data: { portfolioId, accountId, fileName, rows: validRows } });
    },
    onSuccess: (batch) => {
      setResult(batch);
      onImported();
    },
  });

  function runNormalize(header: string[], dataRows: string[][], preset: string, symbolFallback: string) {
    setParseError("");
    setWarnings([]);
    try {
      if (preset === "tradingview") {
        const tv = parseTradingViewTrades(header, dataRows, symbolFallback);
        if (tv.header.length === 0) {
          setParseError(tv.warnings[0] ?? "Couldn't read this file as a TradingView export.");
          setRows(null);
          return;
        }
        setWarnings(tv.warnings);
        setRows(normalizeImportRows(tv.header, tv.rows));
        return;
      }

      const presetDef = IMPORT_PRESETS.find((p) => p.id === preset);
      if (presetDef && presetDef.id !== "generic") {
        const mapped = applyPreset(header, dataRows, presetDef);
        setRows(normalizeImportRows(mapped.header, mapped.rows));
        return;
      }

      setRows(normalizeImportRows(header, dataRows));
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Couldn't parse that file.");
      setRows(null);
    }
  }

  function onPresetChange(next: string) {
    setPresetId(next);
    setResult(null);
    if (rawParsed) runNormalize(rawParsed.header, rawParsed.dataRows, next, defaultSymbol);
  }

  function onDefaultSymbolChange(next: string) {
    setDefaultSymbol(next);
    if (rawParsed && presetId === "tradingview") runNormalize(rawParsed.header, rawParsed.dataRows, presetId, next);
  }

  async function onFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setResult(null);
    setFileName(file.name);

    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      const [header, ...dataRows] = parsed;
      if (!header || dataRows.length === 0) {
        setParseError("Couldn't find a header row and at least one data row.");
        setRawParsed(null);
        setRows(null);
        return;
      }
      setRawParsed({ header, dataRows });
      runNormalize(header, dataRows, presetId, defaultSymbol);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Couldn't parse that file.");
      setRawParsed(null);
      setRows(null);
    }
  }

  const validCount = rows?.filter((row) => row.normalized).length ?? 0;
  const invalidRows = rows?.filter((row) => !row.normalized) ?? [];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <div>
            <p className="eyebrow mb-1">Bulk import</p>
            <DialogTitle id="import-csv-title">Import trades from CSV</DialogTitle>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
          <div>
            <label htmlFor="import-preset" className="field-label">
              Source format
            </label>
            <Select value={presetId} onValueChange={onPresetChange}>
              <SelectTrigger id="import-preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMPORT_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{activePreset.hint}</p>
          </div>

          {presetId === "tradingview" && (
            <div>
              <label htmlFor="import-default-symbol" className="field-label">
                Symbol (if not in the export)
              </label>
              <Input
                id="import-default-symbol"
                value={defaultSymbol}
                onChange={(e) => onDefaultSymbolChange(e.target.value)}
                placeholder="e.g. EURUSD, BTCUSDT"
              />
            </div>
          )}

          <div>
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload /> Choose CSV file
            </Button>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFileSelected} />
            {fileName && <span className="ml-3 text-xs text-muted-foreground">{fileName}</span>}
          </div>

          {parseError && <p className="text-sm text-destructive">{parseError}</p>}
          {warnings.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {warnings.map((warning) => (
                <li key={warning}>⚠ {warning}</li>
              ))}
            </ul>
          )}

          {rows && (
            <div className="rounded-md border border-border p-3 text-sm">
              <p>
                <span className="font-mono font-semibold text-chart-2">{validCount}</span> row{validCount === 1 ? "" : "s"} ready to
                import
                {invalidRows.length > 0 && (
                  <>
                    , <span className="font-mono font-semibold text-destructive">{invalidRows.length}</span> will be skipped
                  </>
                )}
              </p>
              {invalidRows.length > 0 && (
                <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                  {invalidRows.slice(0, 15).map((row) => (
                    <li key={row.rowNumber}>
                      Line {row.rowNumber}: {row.errors.join("; ")}
                    </li>
                  ))}
                  {invalidRows.length > 15 && <li>…and {invalidRows.length - 15} more</li>}
                </ul>
              )}
            </div>
          )}

          {result && (
            <div className="rounded-md border border-chart-2/40 bg-chart-2/10 p-3 text-sm">
              Imported <span className="font-semibold">{result.imported_rows}</span> of{" "}
              <span className="font-semibold">{result.total_rows}</span> rows.
            </div>
          )}

          {importMutation.isError && (
            <p className="text-sm text-destructive">
              {importMutation.error instanceof Error ? importMutation.error.message : "Import failed."}
            </p>
          )}

          <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-3 border-t border-border bg-card p-6 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              {result ? "Close" : "Cancel"}
            </Button>
            {!result && (
              <Button
                type="button"
                className="flex-1"
                disabled={!rows || validCount === 0 || importMutation.isPending}
                onClick={() => importMutation.mutate()}
              >
                {importMutation.isPending ? "Importing…" : `Import ${validCount} trade${validCount === 1 ? "" : "s"}`}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
