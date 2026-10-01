// CSV trade import modal. Supports a generic format (matching what Export
// CSV produces) plus broker/platform presets (MT4, cTrader, Bybit,
// TradingView) — see lib/import-presets.ts for the column-remapping logic.
// Binance and Coinbase are deliberately NOT one-click presets: those
// platforms export individual fills, not round-trip trades, and silently
// treating a fill as a complete trade would misstate P&L. The dropdown
// includes an entry that explains this rather than pretending to support it.
import { useMutation } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-form";
import { Upload } from "lucide-react";
import { useDropzone } from "react-dropzone";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { normalizeImportRows, parseCsv, type ImportRowResult } from "@/lib/csv";
import { useAppForm } from "@/lib/form";
import { applyPreset, IMPORT_PRESETS, parseTradingViewTrades } from "@/lib/import-presets";
import { importTrades } from "@/lib/import.functions";

interface ParsedFile {
  fileName: string;
  header: string[];
  dataRows: string[][];
}

interface ImportPreview {
  rows: ImportRowResult[] | null;
  warnings: string[];
  error: string;
}

/** Pure: turns the parsed file + the chosen source format into validated rows.
 * Because it's derived on every render from (file, preset, symbol) there is
 * no separate `rows` / `warnings` / `parseError` state to keep in sync when
 * the person changes the dropdown after choosing a file. */
function buildPreview(file: ParsedFile | undefined, presetId: string, defaultSymbol: string): ImportPreview {
  if (!file) return { rows: null, warnings: [], error: "" };
  try {
    if (presetId === "tradingview") {
      const tv = parseTradingViewTrades(file.header, file.dataRows, defaultSymbol);
      if (tv.header.length === 0) {
        return { rows: null, warnings: [], error: tv.warnings[0] ?? "Couldn't read this file as a TradingView export." };
      }
      return { rows: normalizeImportRows(tv.header, tv.rows), warnings: tv.warnings, error: "" };
    }
    const presetDef = IMPORT_PRESETS.find((p) => p.id === presetId);
    if (presetDef && presetDef.id !== "generic") {
      const mapped = applyPreset(file.header, file.dataRows, presetDef);
      return { rows: normalizeImportRows(mapped.header, mapped.rows), warnings: [], error: "" };
    }
    return { rows: normalizeImportRows(file.header, file.dataRows), warnings: [], error: "" };
  } catch (error) {
    return { rows: null, warnings: [], error: error instanceof Error ? error.message : "Couldn't parse that file." };
  }
}

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
  const importMutation = useMutation({
    mutationFn: ({ rows, fileName }: { rows: ImportRowResult[]; fileName: string }) => {
      const validRows = rows.flatMap((row) => (row.normalized ? [row.normalized] : []));
      return importTrades({ data: { portfolioId, accountId, fileName, rows: validRows } });
    },
    onSuccess: onImported,
  });

  // Reading + parsing the chosen file is async, so it's a mutation: its
  // `data` is the parsed file and its `error` the "couldn't read" message.
  const parseFile = useMutation({
    mutationFn: async (file: File): Promise<ParsedFile> => {
      const [header, ...dataRows] = parseCsv(await file.text());
      if (!header || dataRows.length === 0) throw new Error("Couldn't find a header row and at least one data row.");
      return { fileName: file.name, header, dataRows };
    },
    onMutate: () => importMutation.reset(),
  });

  // Source format + fallback symbol are the only inputs; everything else on
  // screen is derived from them and the parsed file.
  const form = useAppForm({
    defaultValues: { presetId: "generic", defaultSymbol: "" },
    listeners: { onChange: () => importMutation.reset() },
  });
  const { presetId, defaultSymbol } = useStore(form.store, (state) => state.values);
  const activePreset = IMPORT_PRESETS.find((p) => p.id === presetId) ?? IMPORT_PRESETS[0]!;

  const { getRootProps, getInputProps, open } = useDropzone({
    accept: { "text/csv": [".csv"] },
    multiple: false,
    noClick: true,
    noKeyboard: true,
    onDropAccepted: ([file]) => file && parseFile.mutate(file),
  });

  const preview = buildPreview(parseFile.data, presetId, defaultSymbol);
  const parseError = parseFile.error?.message ?? preview.error;
  const result = importMutation.data;
  const validCount = preview.rows?.filter((row) => row.normalized).length ?? 0;
  const invalidRows = preview.rows?.filter((row) => !row.normalized) ?? [];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <div>
            <p className="eyebrow mb-1">Bulk import</p>
            <DialogTitle id="import-csv-title">Import trades from CSV</DialogTitle>
          </div>
        </DialogHeader>

        <div {...getRootProps({ className: "min-h-0 flex-1 space-y-4 overflow-y-auto p-6" })}>
          <input {...getInputProps()} />
          <form.AppField name="presetId">
            {(field) => (
              <field.SelectField
                label="Source format"
                id="import-preset"
                options={IMPORT_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
                hint={<span className="leading-5">{activePreset.hint}</span>}
              />
            )}
          </form.AppField>

          {presetId === "tradingview" && (
            <form.AppField name="defaultSymbol">
              {(field) => (
                <field.TextField
                  label="Symbol (if not in the export)"
                  id="import-default-symbol"
                  placeholder="e.g. EURUSD, BTCUSDT"
                />
              )}
            </form.AppField>
          )}

          <div>
            <Button type="button" variant="outline" onClick={open} disabled={parseFile.isPending}>
              <Upload /> Choose CSV file
            </Button>
            {parseFile.data && <span className="ml-3 text-xs text-muted-foreground">{parseFile.data.fileName}</span>}
          </div>

          {parseError && <p className="text-sm text-destructive">{parseError}</p>}
          {preview.warnings.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {preview.warnings.map((warning) => (
                <li key={warning}>⚠ {warning}</li>
              ))}
            </ul>
          )}

          {preview.rows && (
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
            <p className="text-sm text-destructive">{importMutation.error.message || "Import failed."}</p>
          )}

          <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-3 border-t border-border bg-card p-6 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              {result ? "Close" : "Cancel"}
            </Button>
            {!result && (
              <Button
                type="button"
                className="flex-1"
                disabled={!preview.rows || validCount === 0 || importMutation.isPending}
                onClick={() => preview.rows && importMutation.mutate({ rows: preview.rows, fileName: parseFile.data?.fileName ?? "" })}
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
