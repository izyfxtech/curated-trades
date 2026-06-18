import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { entities } from "@/api/entities";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Parses a CSV string into an array of objects using the first row as headers.
 */
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, "").toLowerCase().replace(/\s+/g, "_"));
  return lines.slice(1).map(line => {
    const values = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });
}

/** Map common CSV column names to our Trade schema. */
function mapRow(row) {
  const num = (v) => (v !== "" && v !== undefined && !isNaN(parseFloat(v)) ? parseFloat(v) : undefined);
  const str = (v) => (v && v !== "" ? String(v) : undefined);

  const symbol = str(row.symbol ?? row.instrument ?? row.pair ?? row.ticker);
  const pnl = num(row.pnl ?? row.profit ?? row["profit/loss"] ?? row.net_profit);
  const direction_raw = str(row.direction ?? row.type ?? row.side ?? row.order_type ?? "");
  const direction = direction_raw?.toLowerCase().includes("buy") || direction_raw?.toLowerCase().includes("long")
    ? "long"
    : direction_raw?.toLowerCase().includes("sell") || direction_raw?.toLowerCase().includes("short")
    ? "short"
    : undefined;

  const commission = num(row.commission ?? row.fees ?? row.fee);
  const swap = num(row.swap ?? row.rollover);
  const net_pnl = num(row.net_pnl) ?? (pnl !== undefined ? (pnl - (commission ?? 0) - (swap ?? 0)) : undefined);

  const outcome = pnl !== undefined
    ? pnl > 0 ? "win" : pnl < 0 ? "loss" : "breakeven"
    : undefined;

  return {
    symbol,
    direction,
    entry_price: num(row.entry_price ?? row.open_price ?? row.entry ?? row.open),
    exit_price: num(row.exit_price ?? row.close_price ?? row.exit ?? row.close),
    stop_loss: num(row.stop_loss ?? row.sl),
    take_profit: num(row.take_profit ?? row.tp),
    lot_size: num(row.lot_size ?? row.lots ?? row.quantity ?? row.volume ?? row.size),
    pnl,
    commission,
    swap,
    net_pnl,
    open_time: str(row.open_time ?? row.entry_time ?? row.open_date ?? row.date_open),
    close_time: str(row.close_time ?? row.exit_time ?? row.close_date ?? row.date_close),
    strategy: str(row.strategy ?? row.setup),
    notes: str(row.notes ?? row.comment ?? row.comments),
    outcome,
    platform: str(row.platform),
  };
}

export default function ImportTradesDialog({ open, onClose }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const queryClient = useQueryClient();

  const handleFileChange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResult(null);

    // Show a preview of parsed rows
    try {
      const text = await f.text();
      let rows;
      if (f.name.endsWith(".json")) {
        const parsed = JSON.parse(text);
        rows = Array.isArray(parsed) ? parsed : parsed.trades ?? [];
      } else {
        rows = parseCsv(text);
      }
      const mapped = rows.map(mapRow).filter(r => r.symbol);
      setPreview(mapped);
    } catch {
      setPreview(null);
    }
  };

  const handleImport = async () => {
    if (!preview?.length) return;
    setLoading(true);
    try {
      // Insert one by one (Supabase JS v2 supports batch insert via array)
      const { supabase } = await import("@/api/supabaseClient");
      const { data: { user } } = await supabase.auth.getUser();
      const payload = preview.map(t => ({ ...t, user_id: user.id }));
      const { error } = await supabase.from("trades").insert(payload);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["trades"] });
      setResult({ success: true, count: preview.length });
    } catch (err) {
      setResult({ success: false, error: err.message || "Import failed" });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setResult(null);
    setPreview(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="dark max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle>Import Trades</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="py-8 text-center">
            {result.success ? (
              <>
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                <p className="text-foreground font-medium">Imported {result.count} trades</p>
                <Button onClick={handleClose} className="mt-4">Done</Button>
              </>
            ) : (
              <>
                <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-3" />
                <p className="text-destructive mb-2">Import failed</p>
                <p className="text-sm text-muted-foreground">{result.error}</p>
                <Button variant="outline" onClick={() => setResult(null)} className="mt-4">Try Again</Button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a <strong>CSV</strong> or <strong>JSON</strong> file exported from your broker or trading platform.
              Standard column names (symbol, direction, entry_price, pnl, etc.) are auto-mapped.
            </p>

            <label className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary/50 transition-colors">
              {file ? (
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  <span className="text-sm text-foreground">{file.name}</span>
                </div>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                  <span className="text-sm text-muted-foreground">Click to select file</span>
                  <span className="text-xs text-muted-foreground/70 mt-1">CSV or JSON</span>
                </>
              )}
              <input type="file" accept=".csv,.json" className="hidden" onChange={handleFileChange} />
            </label>

            {preview !== null && (
              <div className={`text-xs rounded-lg px-3 py-2 ${preview.length > 0 ? "bg-emerald-400/10 text-emerald-400" : "bg-destructive/10 text-destructive"}`}>
                {preview.length > 0
                  ? `${preview.length} trade${preview.length !== 1 ? "s" : ""} detected — ready to import`
                  : "No valid trades found. Check that your file has a 'symbol' column."}
              </div>
            )}

            <Button onClick={handleImport} disabled={!preview?.length || loading} className="w-full">
              {loading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing...</>
                : <><Upload className="w-4 h-4 mr-2" />Import {preview?.length ? `${preview.length} trades` : "Trades"}</>}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
