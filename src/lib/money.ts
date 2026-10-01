// Shared currency-aware money formatting. Every account has its own
// base_currency (a portfolio can hold accounts in different currencies), so
// nothing in the app should hardcode "$" — it should format with whichever
// account's currency the figure actually belongs to. Centralizing this means
// that fix only has to be made once.

/** "$1,234" / "€1,234" — Intl-based, falls back to "1,234 XYZ" for a currency code Intl doesn't recognize. */
export function formatMoney(amount: number, currency: string, fractionDigits = 0): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString(undefined, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })} ${currency}`;
  }
}

/** "+$1,234" / "−$1,234" — the +/− prefixed style used for P&L throughout the app (a real minus sign, not a hyphen). */
export function formatSignedMoney(amount: number, currency: string, fractionDigits = 0): string {
  const sign = amount >= 0 ? "+" : "−";
  return `${sign}${formatMoney(Math.abs(amount), currency, fractionDigits)}`;
}

/** Just the currency's symbol/prefix ("$", "€", "CHF "), for building compact labels like axis ticks. */
export function currencyPrefix(currency: string): string {
  try {
    const part = new Intl.NumberFormat(undefined, { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency");
    return part?.value ?? `${currency} `;
  } catch {
    return `${currency} `;
  }
}

/** "$12k" / "-€3k" — compact axis-label style for the equity curve's y-axis. */
export function formatMoneyCompact(amount: number, currency: string): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}${currencyPrefix(currency)}${Math.round(Math.abs(amount) / 1000)}k`;
}

/** The account whose currency a workspace-level (non-per-trade) figure should display in: the active account's, or the portfolio's first account's, or USD if the portfolio has none yet. Matches the convention already used for sizing (see instruments.ts). */
export function workspaceCurrency(workspace: {
  activeAccount?: { base_currency: string } | null;
  accounts: { base_currency: string }[];
}): string {
  return (workspace.activeAccount?.base_currency ?? workspace.accounts[0]?.base_currency ?? "USD").toUpperCase();
}

/** account_id → base_currency, for contexts (the trade table, the screenshot gallery) that can show trades from several accounts of different currencies at once. */
export function currencyByAccountId(accounts: { id: string; base_currency: string }[]): Map<string, string> {
  return new Map(accounts.map((account) => [account.id, account.base_currency.toUpperCase()]));
}
