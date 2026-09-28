// Maps common broker/platform trade-history exports onto the canonical
// column set normalizeImportRows() already validates (see csv.ts). Each
// preset only relabels and lightly reformats columns — the actual
// validation and shape checking still happens in one place afterwards.

export type CanonicalField =
  | "symbol"
  | "direction"
  | "status"
  | "opened_at"
  | "closed_at"
  | "entry_price"
  | "exit_price"
  | "quantity"
  | "stop_loss"
  | "take_profit"
  | "fees"
  | "notes";

const CANONICAL_FIELDS: CanonicalField[] = [
  "symbol",
  "direction",
  "status",
  "opened_at",
  "closed_at",
  "entry_price",
  "exit_price",
  "quantity",
  "stop_loss",
  "take_profit",
  "fees",
  "notes",
];

export interface ImportPreset {
  id: string;
  label: string;
  hint: string;
  aliases: Partial<Record<CanonicalField, string[]>>;
  defaults?: Partial<Record<CanonicalField, string>>;
  transformDirection?: (raw: string) => string;
  transformDate?: (raw: string) => string;
}

/** MT4-style dates ("2024.01.15 10:23:45") — swap the date dots for dashes so Date parsing is reliable. */
function mt4Date(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{4})\.(\d{2})\.(\d{2})(.*)$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}${match[4]}` : trimmed;
}

function buySellDirection(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value === "buy" || value === "long" || value === "b" || value === "0") return "long";
  if (value === "sell" || value === "short" || value === "s" || value === "1") return "short";
  return value;
}

export const IMPORT_PRESETS: ImportPreset[] = [
  {
    id: "generic",
    label: "Generic / Curated Trades format",
    hint: "Header row needs at least: symbol, direction, status, opened_at, entry_price, quantity. Closed trades also need exit_price and closed_at. Optional: stop_loss, take_profit, fees, curated_label, notes. This is exactly what Export CSV produces.",
    aliases: {},
  },
  {
    id: "mt4",
    label: "MetaTrader 4",
    hint: "Trade history / account statement export. Looks for Open Time, Type, Item, Lots, Open Price, Close Time, Close Price, S/L, T/P, Commission.",
    aliases: {
      symbol: ["item", "symbol"],
      direction: ["type", "cmd"],
      opened_at: ["open time", "opentime"],
      closed_at: ["close time", "closetime"],
      entry_price: ["open price", "openprice", "price"],
      exit_price: ["close price", "closeprice"],
      quantity: ["lots", "size", "volume"],
      stop_loss: ["s/l", "sl"],
      take_profit: ["t/p", "tp"],
      fees: ["commission"],
    },
    defaults: { status: "closed" },
    transformDirection: buySellDirection,
    transformDate: mt4Date,
  },
  {
    id: "ctrader",
    label: "cTrader",
    hint: "History tab export. Looks for Symbol, Direction, Volume, Entry Price, Entry Time, Closing Price, Closing Time, Commission.",
    aliases: {
      symbol: ["symbol"],
      direction: ["direction"],
      opened_at: ["entry time", "opening time"],
      closed_at: ["closing time", "exit time"],
      entry_price: ["entry price"],
      exit_price: ["closing price", "exit price"],
      quantity: ["volume", "volume (lots)", "quantity"],
      fees: ["commission"],
    },
    defaults: { status: "closed" },
    transformDirection: buySellDirection,
  },
  {
    id: "bybit",
    label: "Bybit (Closed P&L)",
    hint: "Derivatives → Closed P&L export. Looks for Contracts, Side, Qty, Entry Price, Exit Price, Entry/Exit Trading Time.",
    aliases: {
      symbol: ["contracts", "symbol"],
      direction: ["side", "direction"],
      opened_at: ["entry trading time(utc)", "entry time", "create time"],
      closed_at: ["exit trading time(utc)", "exit time", "close time"],
      entry_price: ["entry price", "avg entry price"],
      exit_price: ["exit price", "avg exit price"],
      quantity: ["qty", "closed qty"],
      fees: ["closed fee", "trading fee", "fee"],
    },
    defaults: { status: "closed" },
    transformDirection: buySellDirection,
  },
  {
    id: "tradingview",
    label: "TradingView (List of Trades)",
    hint: 'Strategy tester or paper-trading "List of Trades" export. Pairs each Entry/Exit row into one closed trade.',
    aliases: {},
  },
  {
    id: "fills-note",
    label: "Binance / Coinbase",
    hint: "These export individual fills, not round-trip trades, so there's no safe automatic mapping — combining fills incorrectly would misstate your P&L. Aggregate each position's entry and exit into one row yourself using the generic format, then import that.",
    aliases: {},
  },
];

export interface PresetMapResult {
  header: string[];
  rows: string[][];
}

/** Remaps a foreign header row onto canonical column names using a preset's alias list. */
export function applyPreset(headerRow: string[], dataRows: string[][], preset: ImportPreset): PresetMapResult {
  const lowerHeaders = headerRow.map((h) => h.trim().toLowerCase());
  const colIndexForField = new Map<CanonicalField, number>();

  for (const field of CANONICAL_FIELDS) {
    let idx = lowerHeaders.indexOf(field);
    if (idx === -1) {
      for (const alias of preset.aliases[field] ?? []) {
        idx = lowerHeaders.indexOf(alias);
        if (idx !== -1) break;
      }
    }
    if (idx !== -1) colIndexForField.set(field, idx);
  }

  const presentFields = CANONICAL_FIELDS.filter(
    (field) => colIndexForField.has(field) || preset.defaults?.[field] !== undefined,
  );

  const rows = dataRows.map((cells) =>
    presentFields.map((field) => {
      const idx = colIndexForField.get(field);
      let value = idx !== undefined ? (cells[idx] ?? "").trim() : (preset.defaults?.[field] ?? "");
      if (field === "direction" && preset.transformDirection) value = preset.transformDirection(value);
      if ((field === "opened_at" || field === "closed_at") && preset.transformDate && value) {
        value = preset.transformDate(value);
      }
      return value;
    }),
  );

  return { header: presentFields, rows };
}

export interface TradingViewMapResult extends PresetMapResult {
  warnings: string[];
}

/**
 * TradingView's "List of Trades" export is shaped differently from the rest:
 * it's one row per entry/exit action rather than one row per round-trip
 * trade, so it needs pairing by Trade # before it fits the canonical shape.
 */
export function parseTradingViewTrades(
  headerRow: string[],
  dataRows: string[][],
  defaultSymbol: string,
): TradingViewMapResult {
  const lowerHeaders = headerRow.map((h) => h.trim().toLowerCase());
  const findIndex = (names: string[]) => {
    for (const name of names) {
      const idx = lowerHeaders.indexOf(name);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const tradeIdx = findIndex(["trade #", "trade#", "trade"]);
  const typeIdx = findIndex(["type"]);
  const dateIdx = findIndex(["date/time", "date", "datetime"]);
  const priceIdx = findIndex(["price", "price usd"]);
  const qtyIdx = findIndex(["contracts", "position size", "quantity", "shares"]);
  const symbolIdx = findIndex(["symbol", "ticker"]);

  if (tradeIdx === -1 || typeIdx === -1 || dateIdx === -1 || priceIdx === -1) {
    return {
      header: [],
      rows: [],
      warnings: [
        'This doesn\'t look like a TradingView "List of Trades" export — expected Trade #, Type, Date/Time, and Price columns.',
      ],
    };
  }

  const groups = new Map<string, string[][]>();
  for (const cells of dataRows) {
    const key = cells[tradeIdx] ?? "";
    const existing = groups.get(key);
    if (existing) existing.push(cells);
    else groups.set(key, [cells]);
  }

  const header: CanonicalField[] = [
    "symbol",
    "direction",
    "status",
    "opened_at",
    "closed_at",
    "entry_price",
    "exit_price",
    "quantity",
  ];
  const rows: string[][] = [];
  let skipped = 0;

  for (const group of groups.values()) {
    const entryRow = group.find((r) => (r[typeIdx] ?? "").toLowerCase().includes("entry"));
    const exitRow = group.find((r) => (r[typeIdx] ?? "").toLowerCase().includes("exit"));
    if (!entryRow || !exitRow) {
      skipped++;
      continue;
    }

    const typeText = (entryRow[typeIdx] ?? "").toLowerCase();
    const direction = typeText.includes("short") ? "short" : "long";
    const symbol = symbolIdx !== -1 ? (entryRow[symbolIdx] ?? "").trim() : defaultSymbol.trim();
    const quantity = qtyIdx !== -1 ? (entryRow[qtyIdx] ?? exitRow[qtyIdx] ?? "").trim() : "";

    rows.push([
      symbol.toUpperCase(),
      direction,
      "closed",
      (entryRow[dateIdx] ?? "").trim(),
      (exitRow[dateIdx] ?? "").trim(),
      (entryRow[priceIdx] ?? "").trim(),
      (exitRow[priceIdx] ?? "").trim(),
      quantity,
    ]);
  }

  const warnings: string[] = [];
  if (skipped > 0) {
    warnings.push(`${skipped} trade${skipped === 1 ? "" : "s"} skipped — no matching entry/exit pair (likely still open).`);
  }
  if (symbolIdx === -1 && !defaultSymbol.trim()) {
    warnings.push("No symbol column found in this export — enter a default symbol above so rows aren't rejected.");
  }

  return { header, rows, warnings };
}
