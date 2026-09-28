-- Lot sizing (calculation v2): crosses need a quote → account-currency rate.
--
-- Forex/metal trades are sized in LOTS and P&L is
--   price move × lots × contract size × (quote → account currency rate).
-- For a pair priced in the account currency (EURUSD on a USD account) the rate
-- is 1, and for one where the account currency is the base (USDJPY, USDCHF) it
-- is 1 / price, so both are derived from the trade's own prices. Only crosses
-- (EURGBP, GBPJPY…) need the person to say what 1 unit of the quote currency
-- is worth in the account currency — stored here so the trade can be
-- recomputed later (partial exits, edits) without asking again.
--
-- Nullable and additive: existing rows are unaffected. Idempotent.
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS quote_rate NUMERIC(20, 10);

ALTER TABLE public.trades
  DROP CONSTRAINT IF EXISTS trades_quote_rate_positive;
ALTER TABLE public.trades
  ADD CONSTRAINT trades_quote_rate_positive CHECK (quote_rate IS NULL OR quote_rate > 0);
