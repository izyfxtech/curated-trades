// Screenshot review view for Journal — a task the table genuinely can't do
// (visual chart review), not just the same rows arranged differently, which
// is why this exists as a second view instead of a third/fourth one.
// Groups already-fetched attachments by trade and shows only trades that
// actually have a screenshot; clicking a card opens that trade's edit
// modal, same as clicking a row in table view.
import { ImageOff } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import { formatSignedMoney } from "@/lib/money";
import type { AttachmentWithUrl } from "@/lib/attachments.functions";
import type { Database } from "@/integrations/supabase/types";

type TradeRowData = Database["public"]["Tables"]["trades"]["Row"];

export function TradeGallery({
  trades,
  attachments,
  isLoading,
  currencyByAccountId,
}: {
  trades: TradeRowData[];
  attachments: AttachmentWithUrl[];
  isLoading: boolean;
  /** account_id → currency — cards can span accounts of different currencies when "All accounts" is selected. */
  currencyByAccountId: Map<string, string>;
}) {
  const navigate = useNavigate();
  const attachmentsByTradeId = new Map<string, AttachmentWithUrl[]>();
  for (const attachment of attachments) {
    const list = attachmentsByTradeId.get(attachment.trade_id) ?? [];
    list.push(attachment);
    attachmentsByTradeId.set(attachment.trade_id, list);
  }

  const tradesWithScreenshots = trades.filter((trade) => (attachmentsByTradeId.get(trade.id)?.length ?? 0) > 0);

  if (isLoading) {
    return <p className="surface-panel py-16 text-center text-sm text-muted-foreground">Loading screenshots…</p>;
  }

  if (tradesWithScreenshots.length === 0) {
    return (
      <div className="surface-panel py-16 text-center text-sm text-muted-foreground">
        <ImageOff className="mx-auto mb-3 size-6" />
        No trades with screenshots in the current filter.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {tradesWithScreenshots.map((trade) => {
        const tradeAttachments = attachmentsByTradeId.get(trade.id) ?? [];
        const cover = tradeAttachments[0];
        const netPnl = trade.net_pnl ?? 0;
        return (
          <button
            type="button"
            key={trade.id}
            onClick={() => void navigate({ to: "/app/journal/$tradeId", params: { tradeId: trade.id } })}
            className="surface-panel group overflow-hidden p-0 text-left"
          >
            <div className="relative aspect-video overflow-hidden bg-muted">
              {cover?.signedUrl ? (
                <img
                  src={cover.signedUrl}
                  alt={cover.caption ?? `${trade.symbol} screenshot`}
                  className="size-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />
              ) : (
                <div className="flex size-full items-center justify-center text-muted-foreground">
                  <ImageOff className="size-6" />
                </div>
              )}
              {tradeAttachments.length > 1 && (
                <span className="absolute right-2 top-2 rounded-sm border border-border bg-card shadow-xs px-1.5 py-0.5 font-mono text-xs">
                  +{tradeAttachments.length - 1}
                </span>
              )}
            </div>
            <div className="p-3">
              <p className="text-sm font-semibold">{trade.symbol}</p>
              <p className={`font-mono text-xs font-medium ${netPnl >= 0 ? "text-chart-2" : "text-destructive"}`}>
                {formatSignedMoney(netPnl, currencyByAccountId.get(trade.account_id) ?? "USD")}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
