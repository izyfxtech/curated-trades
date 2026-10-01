// CSV in and out. Parsing and serializing are delegated to PapaParse (and the
// download itself to file-saver); what remains here is the part that is
// specific to this app: a normalizer that maps parsed rows onto the same field
// shape trades.functions.ts's buildTradePayload expects.
import { saveAs } from "file-saver";
import Papa from "papaparse";

import type { Direction, TradeStatus } from "@/lib/trade-calc";

/** Parses CSV text into rows of cells (quotes, escaped quotes, CRLF and a
 * leading BOM are PapaParse's problem, not ours). Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  return Papa.parse<string[]>(text, { skipEmptyLines: "greedy" }).data;
}

/** Serializes rows to CSV and hands the browser a download. Used by every
 * "Export CSV" button, so quoting/escaping is PapaParse's job in one place
 * rather than a hand-built `"${cell}"` join per page. */
export function downloadCsv(filename: string, header: string[], rows: unknown[][]) {
  const csv = Papa.unparse({ fields: header, data: rows.map((row) => row.map((cell) => cell ?? "")) });
  saveAs(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
}

export interface NormalizedImportRow {
  symbol: string;
  direction: Direction;
  status: TradeStatus;
  openedAt: string;
  closedAt: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  stopLoss: number | null;
  takeProfit: number | null;
  fees: number;
  isPlanned: boolean;
  notes: string | null;
}

export interface ImportRowResult {
  rowNumber: number;
  raw: Record<string, string>;
  errors: string[];
  normalized: NormalizedImportRow | null;
}

const REQUIRED_COLUMNS = ["symbol", "direction", "status", "opened_at", "entry_price", "quantity"];

function parseDate(value: string): string | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function normalizeImportRows(headerRow: string[], dataRows: string[][]): ImportRowResult[] {
  const headers = headerRow.map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
  if (missing.length > 0) {
    throw new Error(`CSV is missing required column(s): ${missing.join(", ")}`);
  }

  const indexOf = (name: string) => headers.indexOf(name);

  return dataRows.map((cells, idx): ImportRowResult => {
    const get = (name: string): string => {
      const i = indexOf(name);
      if (i === -1) return "";
      return (cells[i] ?? "").trim();
    };

    const raw: Record<string, string> = {};
    headers.forEach((header, i) => {
      raw[header] = cells[i] ?? "";
    });

    const errors: string[] = [];

    const symbol = get("symbol").toUpperCase();
    if (!symbol) errors.push("Missing symbol");

    const directionRaw = get("direction").toLowerCase();
    const direction: Direction = directionRaw === "short" ? "short" : "long";
    if (directionRaw !== "long" && directionRaw !== "short") {
      errors.push(`Unrecognized direction "${get("direction") || "(blank)"}" — expected "long" or "short"`);
    }

    const statusRaw = get("status").toLowerCase();
    const validStatuses: TradeStatus[] = ["open", "closed", "cancelled", "incomplete"];
    const status: TradeStatus = validStatuses.includes(statusRaw as TradeStatus)
      ? (statusRaw as TradeStatus)
      : "closed";
    if (!validStatuses.includes(statusRaw as TradeStatus)) {
      errors.push(`Unrecognized status "${get("status") || "(blank)"}" — expected one of ${validStatuses.join(", ")}`);
    }

    const openedAt = parseDate(get("opened_at"));
    if (!openedAt) errors.push(`Missing or invalid opened_at ("${get("opened_at")}")`);

    const closedAtRaw = get("closed_at");
    const closedAt = closedAtRaw ? parseDate(closedAtRaw) : null;
    if (closedAtRaw && !closedAt) errors.push(`Invalid closed_at ("${closedAtRaw}")`);

    const entryPrice = parseOptionalNumber(get("entry_price"));
    if (entryPrice == null || entryPrice <= 0) errors.push(`Missing or invalid entry_price ("${get("entry_price")}")`);

    const quantity = parseOptionalNumber(get("quantity"));
    if (quantity == null || quantity <= 0) errors.push(`Missing or invalid quantity ("${get("quantity")}")`);

    const exitPrice = parseOptionalNumber(get("exit_price"));
    if (status === "closed" && (exitPrice == null || exitPrice <= 0)) {
      errors.push("Closed trades require a valid exit_price");
    }
    if (status === "closed" && !closedAt) {
      errors.push("Closed trades require a valid closed_at");
    }

    const stopLoss = parseOptionalNumber(get("stop_loss"));
    const takeProfit = parseOptionalNumber(get("take_profit"));
    const fees = parseOptionalNumber(get("fees")) ?? 0;
    const curatedLabel = get("curated_label").toLowerCase();
    const isPlanned = curatedLabel ? curatedLabel === "curated" : true;
    const notes = get("notes") || null;

    const normalized: NormalizedImportRow | null =
      errors.length === 0 && openedAt && entryPrice != null && quantity != null
        ? {
            symbol,
            direction,
            status,
            openedAt,
            closedAt: status === "closed" ? closedAt : null,
            entryPrice,
            exitPrice: status === "closed" ? exitPrice : null,
            quantity,
            stopLoss,
            takeProfit,
            fees,
            isPlanned,
            notes,
          }
        : null;

    return { rowNumber: idx + 2, raw, errors, normalized }; // +2: header row is line 1, data is 1-indexed
  });
}
