# Phase status

Tracks this codebase against `curated-trades-detailed-supabase-implementation-plan-2026-09-01.md`
(the original plan document). Each item below is the plan's own bullet,
marked with what actually exists in the code today. "Done" means built,
type-checked, and build-verified — not necessarily QA'd against a live
Supabase project, since that requires a real database (see
[`DATABASE.md`](./DATABASE.md) for the migration-application caveat that
applies to every phase below).

## Phase 1 — secure MVP

**Status: done**, with one correctness fix from an independent review after
the fact: `current_equity` fed risk-preview position sizing but was never
updated after portfolio creation — see
[`DECISIONS.md` #31](./DECISIONS.md#d31). Everything below reflects the
fixed state.

- Auth (email/password + Google OAuth), password reset, onboarding flow
  (timezone, base currency, trader type, personal-vs-prop portfolio) —
  `src/routes/sign-in.tsx`, `reset-password.tsx`, `onboarding.tsx`.
- Manual trade capture with the shared decimal-safe calculation layer —
  `src/lib/trade-calc.ts`, `src/lib/trades.functions.ts`,
  `src/components/journal/LogTradeModal.tsx`.
- Dashboard (equity curve, open-risk gauge, Curated vs. Impulse signal) —
  `src/routes/app/index.tsx`.
- CSV import with a generic column-mapping format plus broker/platform
  presets (MT4, cTrader, Bybit, TradingView) — `src/lib/import-presets.ts`,
  `src/components/journal/CsvImportModal.tsx`. Binance/Coinbase are
  deliberately **not** one-click presets — see
  [`DECISIONS.md` #5](./DECISIONS.md#d5).
- Standalone risk/position-size calculator — `src/routes/app/risk-calculator.tsx`.
- Full-account JSON export + filtered trades CSV export — `src/routes/app/settings.tsx`.
- Landing page — `src/routes/index.tsx`.

## Phase 2.1 — playbooks and pre-trade planning

**Status: done.** Migration:
[`20260908120000_phase2_playbooks_and_ideas.sql`](../supabase/migrations/20260908120000_phase2_playbooks_and_ideas.sql).

- Playbooks with ordered checklist items (rules and checklist questions are
  the same table — see
  [`DECISIONS.md` #7](./DECISIONS.md#d7)) —
  `src/lib/playbooks.functions.ts`, `src/components/playbooks/PlaybookEditorModal.tsx`.
- Reference screenshots, reusing the existing trade-screenshots storage
  bucket — `src/components/playbooks/PlaybookAttachmentsPanel.tsx`.
- Pre-trade checklist + confidence score, built into the existing trade
  modal rather than a separate screen — `src/components/journal/LogTradeModal.tsx`.
- Playbook snapshot frozen onto the trade at log time, so editing a
  playbook later doesn't rewrite history — `trades.playbook_snapshot`.
- Trade ideas (pending/taken/missed/invalidated) with "convert to trade" —
  `src/lib/trade-ideas.functions.ts`, `src/routes/app/playbooks.tsx`.
- Missed-opportunity comparison, planned R:R only, gated to 3+ samples per
  group — see
  [`DECISIONS.md` #9](./DECISIONS.md#d9).

## Phase 2.2 — post-trade review and psychology

**Status: done.** Migration:
[`20260909090000_phase2_2_trade_reviews.sql`](../supabase/migrations/20260909090000_phase2_2_trade_reviews.sql).

- `trade_reviews`: plan adherence, post-hoc discipline score, emotional
  state before/during/after, best/worst decision, lesson learned —
  `src/lib/reviews.functions.ts`.
- Mistake/behavior taxonomy (FOMO, revenge, boredom, fear, overconfidence,
  patience, hesitation, late entry, moved stop, oversized position) plus
  custom tags — reuses the existing generic tags system rather than a new
  table; see
  [`DECISIONS.md` #11](./DECISIONS.md#d11).
- Review queue (closed trades missing a review) with quick/full modes —
  `src/routes/app/reviews.tsx`, `src/components/reviews/TradeReviewModal.tsx`.
- Weekly/monthly review pages — stats, top setups, emotional patterns,
  mistakes, and strongest decisions are all derived live, not stored; only
  the written commitment persists (`period_reviews.commitment`).
- Review completion tracked separately from trade logging by construction —
  a trade can be logged with no corresponding `trade_reviews` row, and the
  review queue is exactly "closed trades with no review."
- Voice-to-text, feature-detected — `src/components/journal/VoiceTextarea.tsx`.

## Phase 2.3 — deeper analytics

**Status: done.** No new migration — everything here is computed from
existing tables. Engine: `src/lib/analytics.ts`. UI: `src/routes/app/analytics.tsx`
plus `src/components/analytics/*`.

- Breakdowns by setup, playbook, symbol, market, direction, session, day of
  week, hour, holding duration, emotion, mistake, and plan adherence — all
  eleven, one dimension selector.
- Planned vs. realized R, average winner/loser in R, payoff ratio, recovery
  factor, streak distributions.
- R-distribution histogram; breakdown explorer sorted by net P&L rather than
  dumping every statistic at once.
- Configurable minimum sample size (UI control, not persisted — see
  [`DECISIONS.md` #19](./DECISIONS.md#d19)),
  visible date range, and drill-down from each breakdown row to its
  underlying trades (inline expansion, not cross-page navigation — see
  [`DECISIONS.md` #17](./DECISIONS.md#d17)).
- Deterministic insight cards — exactly three explicit rules, no AI or
  statistical inference; see
  [`DECISIONS.md` #18](./DECISIONS.md#d18).

## Phase 2.4 — prop-firm compliance

**Status: done.** Migration:
[`20260911090000_phase2_4_prop_firm_compliance.sql`](../supabase/migrations/20260911090000_phase2_4_prop_firm_compliance.sql).

- `prop_firm_rules`: one rule profile per portfolio (max daily loss %, max
  total drawdown %, profit target %, min/max trading days, consistency %,
  weekend holding / news trading toggles) — `src/lib/prop-firm.functions.ts`.
- Explicit calculation basis per profile (`starting_balance` /
  `current_balance` / `high_water_mark`) — see
  [`DECISIONS.md` #33](./DECISIONS.md#d33) for what this does and doesn't
  cover (no floating P&L; there's no price feed to compute it from).
- Compliance dashboard (remaining daily-loss allowance, remaining drawdown
  allowance, profit-target progress, trading-day count, consistency check)
  — `src/routes/app/prop-rules.tsx`. Pure calculation engine:
  `src/lib/prop-firm-calc.ts`.
- Day boundaries computed in the rule profile's own timezone via
  `Intl.DateTimeFormat`, not a date library — see
  [`DECISIONS.md` #34](./DECISIONS.md#d34).
- Alerts, not lockouts: the dashboard surfaces warnings/breaches clearly and
  never blocks trade entry — see
  [`DECISIONS.md` #36](./DECISIONS.md#d36).
- Rule-event audit trail (`prop_firm_rule_events`), upserted idempotently —
  see [`DECISIONS.md` #35](./DECISIONS.md#d35).
- A follow-up review caught and fixed a real bug: the edit form went stale
  (and could save one portfolio's rules onto another) when switching the
  active portfolio mid-edit — see
  [`DECISIONS.md` #43](./DECISIONS.md#d43).

## Phase 2.5 — sharing and export

**Status: done.** Migration:
[`20260911093000_phase2_5_coach_shares.sql`](../supabase/migrations/20260911093000_phase2_5_coach_shares.sql).

- Coach share links: token-based, with expiration, revocation, portfolio
  scope, and read/comment permission — `src/lib/shares.functions.ts`
  (owner-side management, `src/routes/app/reports.tsx`) and
  `src/lib/public-share.functions.ts` (the public, token-gated read/comment
  path — no RLS exposure to the anon key at all; see
  [`DECISIONS.md` #37](./DECISIONS.md#d37) and
  [#38](./DECISIONS.md#d38) for the security design).
- Privacy modes: `hide_dollar_pnl` redacts dollar figures server-side and
  swaps the equity curve for cumulative R multiple — R/percentage stats,
  screenshots, and notes are unaffected — see
  [`DECISIONS.md` #39](./DECISIONS.md#d39).
- Coach comments, one thread per share link (not yet scoped to individual
  trades — `coach_comments.trade_id` exists in the schema for that but the
  UI doesn't use it yet).
- Polished, printable report view reused for both the owner's own preview
  and the coach's link (`/share/$token`) — see
  [`DECISIONS.md` #40](./DECISIONS.md#d40) and
  [#41](./DECISIONS.md#d41) for why one view and why print-to-PDF rather
  than a generated file.
- Filtered CSV export already existed for Phase 1's own requirement
  (`settings.tsx`/`journal.tsx`) — the Journal page's filters (search,
  status, curated/impulse, date range) were added in this pass so "filtered"
  actually means something; see
  [`DECISIONS.md` #32](./DECISIONS.md#d32).
- A follow-up review found and fixed a real lost-update race in the share
  view counter — see [`DECISIONS.md` #42](./DECISIONS.md#d42).

## Phase 2.6 — Phase 2 validation

**Status: not started.** 2.4 and 2.5 now exist to validate against, but this
phase itself — the plan's own checklist (historical playbook snapshots,
review completeness, period boundaries, DST changes, prop-firm high-water-
mark calculations, share revocation/expiration/hidden fields/unauthorized
access, insight-card-to-trade traceability, and that manual/imported/
future-synced trades share one analytics contract) — hasn't been run. In
particular, prop-firm day-boundary math around DST transitions and the
coach-share revocation/expiration/cross-account-access checks are exactly
the kind of thing worth a deliberate QA pass against a real Supabase
project before relying on either feature for something that matters.

## Phase 3 — automation, intelligence, and coaching ecosystem

**Status: not started.** Unlike Phase 2, several Phase 3 items need real
infrastructure that has to exist *outside* this codebase before code here
matters:

- **3.1 broker/exchange sync** — needs actual credentials and registered
  OAuth apps with each broker/exchange. The plan's own requirements
  (idempotent sync, normalized fill interface, reconciliation screen,
  encrypted credential storage) are all buildable once those exist.
- **3.2 AI-generated insights** — needs an LLM API integration wired up
  with a key/billing of the project owner's own choosing. The plan is
  explicit that this must stay advisory and clearly separated from computed
  facts, never automatic trading — worth re-reading that section closely
  when this phase starts.
- **3.3 community/coaching** — a genuinely different scope: multi-tenant
  sharing, moderation, coach workspaces. Builds on Phase 2.5's share
  infrastructure rather than replacing it.
- **3.4 advanced reporting/personalization** — buildable with existing
  infrastructure (benchmark comparison, Sharpe/volatility metrics, saved
  views, bulk edit/merge/split with change history).
- **3.5 Phase 3 validation** — contract tests against fixture payloads,
  security checks for secret exposure and share-token guessing, monitoring,
  safe retry without duplicating financial records.

## A note on "done"

"Done" throughout this document means: implemented, `tsc --noEmit` clean,
and `vite build` clean (client, SSR, and Nitro server bundles). Where a
migration was added, it was tested for idempotency against a real local
Postgres instance (see [`DATABASE.md`](./DATABASE.md)) — but **no phase
here has been QA'd against the actual live Supabase project**, since that
requires applying the migration there first, which is a manual step for
whoever holds those credentials. Budget for a real QA pass — following the
Phase 2.6 / 3.5 checklists above — before treating any phase as
production-ready.
