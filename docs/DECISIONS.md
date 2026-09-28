# Decisions

Every entry here is a judgment call that wasn't fully dictated by the plan
document — a place where more than one reasonable implementation existed and
one was picked. Organized by area. Each entry says what was decided, why,
and where to look in the code.

## Visual design

<a id="d1"></a>
### 1. "Studio": warm paper and ink, cobalt for "where you are", green/red only for P&L

Supersedes the earlier "Ledger" palette (graphite + brass, then a cool-grey /
navy-topbar dashboard). The look is now editorial — warm paper surfaces, ink
text, Fraunces for page and section titles, soft rounded panels, a left
sidebar instead of a top tab bar — with a matching dark "ink" theme toggled
from the sidebar. Colour roles are deliberately narrow: ink is the primary
action, cobalt (`--chart-1` / `--sidebar-primary`) marks active nav, focus and
the equity line, and green/red are reserved for gain and loss. Everything is a
token in `src/styles.css`, so retuning the whole look is one file.

<a id="d2"></a>
### 2. Every numeric figure is monospace

Dollar amounts, R-multiples, percentages, and counts all use `font-mono`
(JetBrains Mono) wherever they're displayed — trade tables, metric cards,
analytics breakdowns, settings, the risk preview. Deliberate and applied
everywhere at once (see the retheme pass across `dashboard-widgets.tsx`,
`analytics.tsx`, `LogTradeModal.tsx`, `PartialExitsPanel.tsx`,
`CsvImportModal.tsx`), not something to add ad hoc for new figures — any new
numeric display should get `font-mono` too, for consistency.

## Data model

<a id="d3"></a>
### 3. Onboarding is gated in exactly one place

`src/routes/app.tsx`'s layout checks `workspace.profile.onboarding_completed`
after the workspace loads and redirects to `/onboarding` if it's false. This
is the *only* redirect-to-onboarding logic in the app — sign-in, sign-up,
and Google OAuth all just navigate to `/app` on success and let that one
check handle it. Earlier drafts had per-entry-point redirect logic; that's
fragile (miss one entry point, e.g. a future magic-link flow, and it's
broken). One gate, checked after the workspace itself loads, covers every
path by construction.

<a id="d4"></a>
### 4. The risk calculator reuses the trade-logging preview function

`src/routes/app/risk-calculator.tsx` calls the exact same
`calculateRiskPreview` from `src/lib/trade-calc.ts` that
`LogTradeModal.tsx` uses for its pre-save risk preview. Two separate
implementations of "position size from equity + risk% + entry + stop" would
inevitably drift — this way there's one formula, used in both places.

<a id="d5"></a>
### 5. CSV import presets: MT4/cTrader/Bybit yes — Binance/Coinbase deliberately no

MT4, cTrader, and Bybit's "Closed P&L" export all give one row per
round-trip trade, so a column-remapping preset (`src/lib/import-presets.ts`)
is correct. TradingView's "List of Trades" export is one row per entry/exit
*action*, so it needs actual pairing logic (`parseTradingViewTrades`), not
just remapping. Binance and Coinbase's standard exports are individual
**fills**, not round-trip trades — building a preset that silently treated
a fill as a complete trade would misstate P&L, which is the one thing this
app absolutely cannot get wrong. Rather than fake support, the format
dropdown includes an entry that explains why and asks the trader to
aggregate fills into the generic format themselves. Real fill-matching
(FIFO lot accounting) would be a legitimate, separate feature if wanted —
it's a meaningfully bigger scope than a column relabel.

<a id="d6"></a>
### 6. Full-account export caps at 500 trades and excludes attachments

Matches the cap `listTrades` already uses elsewhere in the app, rather than
introducing a second, different limit. Attachments (screenshots) are binary
files, not journal data, and bundling them as base64 into one JSON export
would bloat it substantially for unclear benefit. Both limits are stated in
the Settings page's own copy, not hidden — see `src/routes/app/settings.tsx`.

<a id="d7"></a>
### 7. One checklist table, not "rules" + "checklist questions"

The plan describes both "ordered playbook rules" and "checklist questions
with required/optional behavior" for Phase 2.1. These became one table,
`playbook_checklist_items`, where a rule that must hold is just an item with
`is_required = true`. A rule phrased as a checklist question ("Is price
above the 50 EMA?") is the same kind of thing either way — two parallel
lists would only raise the question of which one actually governs what gets
frozen into `trades.playbook_snapshot`. See the migration comment in
`supabase/migrations/20260908120000_phase2_playbooks_and_ideas.sql`.

<a id="d8"></a>
### 8. Playbook screenshots reuse the trade-screenshots bucket

Stored under `<user_id>/playbooks/<playbook_id>/<filename>` in the existing
`trade-screenshots` Supabase Storage bucket rather than a new bucket. That
bucket's storage policy already scopes access by the first path segment
being the caller's own `auth.uid()` — adding "playbooks" as a subdirectory
under the user's own segment needed no new bucket or policy at all.

<a id="d9"></a>
### 9. Missed-opportunity analytics compares planned R only

The plan is explicit that an idea which was never taken shouldn't be
credited with a realized outcome it never had. `src/routes/app/playbooks.tsx`
compares the *planned* R:R (computed from `planned_entry`/`planned_stop`/
`planned_target` at idea-logging time) between taken and missed/invalidated
groups — never a simulated "what would have happened." Also gated to
requiring 3+ samples in each group before showing the comparison at all.

<a id="d10"></a>
### 10. Playbook snapshot is frozen onto the trade at log time

`trades.playbook_snapshot` (JSONB) captures the playbook's name and
checklist prompts/answers at the moment a trade is logged. Editing or
archiving the playbook afterward never rewrites what a past trade's plan
actually said — this was an explicit plan requirement ("store a snapshot...
so later playbook edits do not rewrite history"), and the snapshot is
write-once per trade (only refreshed if that specific trade is re-edited
through the modal with a playbook re-selected).

<a id="d11"></a>
### 11. Mistake tags reuse the existing tags table

Rather than a new table for the mistake/behavior taxonomy (FOMO, revenge,
boredom, etc.), Phase 2.2 uses the tags table that already existed, with
`category = 'mistake'`. That table's `category` column had no CHECK
constraint restricting its values and its own original comment already
anticipated this ("setups, mistakes, emotions, etc."). A category-scoped
sync function (`syncMistakeTags` in `src/lib/reviews.functions.ts`) ensures
saving a review's mistake tags only ever touches mistake-category links on
that trade, never a trade's other (e.g. setup) tags.

<a id="d12"></a>
### 12. Two discipline scores exist on purpose

`trades.discipline_score` (set when logging the trade, an in-the-moment gut
check) and `trade_reviews.discipline_score` (set later, during considered
post-trade reflection) are deliberately separate fields, not a duplicate or
a bug. They can legitimately differ, and that difference is itself
informative.

<a id="d13"></a>
### 13. Period reviews store only the written commitment

`period_reviews` has exactly one substantive column, `commitment`. Every
other thing a weekly/monthly review page shows — stats, top setups,
emotional patterns, mistakes, strongest decisions — is derived live from
`trades` + `trade_reviews` + `tags` at read time (see `periodStats` in
`src/routes/app/reviews.tsx`). Storing those separately would create a
second source of truth that could silently drift from the underlying data.

<a id="d14"></a>
### 14. Voice-to-text is feature-detected, never UA-sniffed

`src/components/journal/VoiceTextarea.tsx` checks for
`window.SpeechRecognition || window.webkitSpeechRecognition` directly and
only renders the mic button if one exists. The plan's own wording ("only
where browser support is reliable, with a normal text fallback") is taken
literally — this is not a user-agent string check, which would be both less
accurate and more fragile.

## Analytics (Phase 2.3)

<a id="d15"></a>
### 15. Every breakdown group uses the same stats function as the portfolio total

`computeBreakdown` in `src/lib/analytics.ts` calls `summarizeClosedTrades`
(the same function `app/index.tsx` and the top-level Analytics metrics use)
on each group's subset of trades. A breakdown group of 12 trades and the
whole-portfolio total are computed by identical math — there's no separate
"breakdown formula" that could drift out of sync with the rest of the app.

<a id="d16"></a>
### 16. No new charting library

R-multiple distribution and streak distribution are hand-rolled SVG/CSS
(`src/components/analytics/RDistributionChart.tsx`,
`StreakDistributionCard.tsx`), matching the existing daily-P&L heatmap,
which was already built the same way before this phase. The project has no
charting dependency at all; adding one (recharts, d3) for two simple
histograms felt like more weight — and more risk of visually clashing with
the custom design system — than the payoff justified.

<a id="d17"></a>
### 17. Drill-down is inline, not cross-page navigation

Clicking a breakdown group in `BreakdownExplorer.tsx` expands it in place to
show the underlying trades, rather than navigating to a filtered Journal
view. The Journal page has no URL-based filtering today, and building that
felt like scope creep for this pass. This is a reasonable place to revisit
if cross-page filtered links become worth the added plumbing.

<a id="d18"></a>
### 18. Insight cards are 100% rule-based

`generateInsights` in `src/lib/analytics.ts` applies exactly three explicit
threshold rules to every breakdown group (negative expectancy while the
portfolio overall is positive; a group outperforming the overall average by
1.5x; a group's win rate sitting 15+ points below average). No statistical
inference, no AI-generated text, no hidden scoring model — every card that
appears can be traced to one of those three `if` statements. This was a
deliberate choice for auditability: a trader (or a future team member)
should be able to read the function and know exactly why a given insight
showed up.

<a id="d19"></a>
### 19. Min sample size and date range are not persisted

Both are plain `useState` in `src/routes/app/analytics.tsx`, reset on page
reload rather than saved to `portfolio_settings.display_preferences` (which
exists and could hold them). Kept simple for this pass since it avoids a
save mutation and wiring for a fairly low-stakes preference. Worth doing if
it turns out people want their chosen thresholds to persist across
sessions.

<a id="d20"></a>
### 20. Recovery factor's dollar drawdown is computed at the source

`summarizeClosedTrades` (`src/lib/trade-calc.ts`) now returns
`maxDrawdownDollars` alongside `maxDrawdownPercent`, computed in the same
loop where the actual equity peak is tracked. An earlier draft reconstructed
the dollar figure downstream as `startingEquity × drawdownPercent ÷ 100` —
wrong, because the tracked "peak" is the equity high-water mark, which can
exceed `startingEquity` after a profit run-up before the worst drawdown.
That reconstruction would have quietly understated real drawdowns. Fixed by
computing the dollar amount directly where the real peak value is already
known, rather than trying to reverse it out of a percentage.

## Auth and session handling

<a id="d21"></a>
### 21. Sign-in has an explicit re-entry guard, not just a disabled button

`src/routes/sign-in.tsx`'s `onSubmit` checks `if (isSubmitting) return` as
its first line, in addition to the button's `disabled` attribute. The
`disabled` attribute alone doesn't reliably stop a fast double click/tap,
since it only takes effect once React commits the state update to the DOM —
a real bug that caused duplicate sign-up submissions and confusing "already
registered" errors for accounts the *first* click had just created
successfully.

<a id="d22"></a>
### 22. Supabase's masked "already registered" signup response is explicitly detected

When email confirmation is enabled, Supabase's `signUp()` returns the same
success-shaped response (no error, no session) for both a genuinely new
signup and an email that already has a confirmed account — deliberately, to
avoid leaking which emails are registered. `sign-in.tsx` checks
`user.identities.length === 0` to tell the two apart and shows an accurate
message in the latter case, switching to sign-in mode. When email
confirmation is *disabled* (this project's actual current setting),
Supabase returns a real error instead for the common case, and that error
is handled directly — the masked-response branch mainly matters now for a
cross-provider duplicate (e.g. an existing Google-linked account).

<a id="d23"></a>
### 23. First-time profile creation is race-safe

`getWorkspace` (`src/lib/portfolios.functions.ts`) catches a `23505`
(unique-violation) on the profile insert and re-reads instead of throwing —
if a second tab or a fast double-navigation races two inserts for the same
brand-new user, the loser reads what the winner just created instead of
crashing. `profiles.user_id` has a UNIQUE constraint, so this specific race
was real, not theoretical.

<a id="d24"></a>
### 24. Workspace load failures show a real error, not an infinite spinner

Both `app.tsx` and `onboarding.tsx` previously had no error branch for their
`["workspace"]` query at all — any failure just left `isLoading` false and
`workspace` undefined forever, which rendered as "Loading your journal…"
with no explanation and no way out. Both now check `.isError` and show the
actual error message with a "Try again" button. This turned out to be the
direct explanation for reports of the app being "stuck" — the fix isn't
about *preventing* failures, it's about never letting one be silent.

<a id="d25"></a>
### 25. JWT verification uses a shared cached client; the data client stays per-request

`src/integrations/supabase/auth-middleware.ts` used to build a brand-new
Supabase client on every single server function call just to verify the
caller's JWT. On a project using asymmetric JWT signing (implied by the
`sb_publishable_...` key format), verification is normally a fast local
check against a cached JWKS — but a fresh client has an empty cache, so this
was silently paying for a real network fetch on every call in the app, not
just first load. Fixed with one process-wide, long-lived client used only
for `getClaims()` (safe to share, since it takes the token as an argument
rather than holding per-user session state). The client that actually reads
data is still built fresh per request, since it must carry that specific
caller's bearer token for RLS to see the right `auth.uid()`.

## Performance and reliability

<a id="d26"></a>
### 26. QueryClient fails fast instead of retrying silently for seconds

`src/router.tsx` sets `retry: 1` (default is 3, with exponential backoff up
to ~7 seconds total), `staleTime: 30_000` (default 0, meaning every mount
and window refocus refetches everything), and `refetchOnWindowFocus: false`.
Combined with the error-screen fix above, a genuine failure now surfaces in
around a second with a retry button, instead of several seconds of
indistinguishable-from-hanging silence.

<a id="d27"></a>
### 27. Ownership pre-checks removed where RLS already enforces them

Several server functions used to `SELECT` a row first to confirm the caller
owns it, then perform the real write — two round trips where RLS was always
going to enforce the same thing on the write itself. These were collapsed
to one round trip: the write includes an explicit `.eq("owner_id", userId)`
(or relies on the table's `WITH CHECK` clause doing an `EXISTS` check
against the parent portfolio), and a "no rows matched" or RLS rejection is
translated into a friendly message via `src/lib/db-errors.ts`. Each removal
was checked against the actual RLS policy text in the migrations before
being made, not assumed. `src/lib/import.functions.ts` is a deliberate
exception — it kept its pre-check, since without it a bad `portfolioId`
would fail row-by-row inside a loop of up to 2000 rows instead of once, up
front.

## Database and migrations

<a id="d28"></a>
### 28. Migrations are idempotent, including a non-obvious Postgres edge case

Every migration in `supabase/migrations/` can be re-run any number of times
without erroring: `CREATE TABLE`/`CREATE INDEX`/`ALTER TABLE ADD COLUMN` use
`IF NOT EXISTS`; policies and triggers are `DROP ... IF EXISTS` before being
recreated (so an edited definition actually takes effect on re-run, rather
than being silently skipped); constraints are wrapped in a `DO` block, since
Postgres has no `ADD CONSTRAINT IF NOT EXISTS`. That `DO` block needed to
catch **two** different exception classes, not one — a plain `CHECK`
constraint raises `duplicate_object` (42710) on retry, but a `UNIQUE` or
`PRIMARY KEY` constraint raises `duplicate_table` (42P07) instead, because
it's backed by an implicitly-named index under the hood. This was caught by
actually installing Postgres and running every migration three times
against a real database (see [`DATABASE.md`](./DATABASE.md)), not by
reasoning about it — the first version only caught `duplicate_object` and
failed on the second run.

<a id="d29"></a>
### 29. Onboarding awaits its cache invalidation before navigating

`onboarding.tsx`'s finish mutation used to invalidate the `["workspace"]`
query and navigate to `/app` in the same tick, fire-and-forget. `app.tsx`
has its own `["workspace"]` query and redirects straight back to
`/onboarding` if `onboarding_completed` is still `false` — if the
navigation happened before the invalidated query's background refetch
actually completed, `/app` would mount with the *stale* pre-save cache, see
the old `false`, and bounce right back. The fix is one word: `await` the
invalidation before navigating.

<a id="d30"></a>
### 30. Migrations require a manual step — no live database access from this environment

Every migration in this project was written and idempotency-tested against
a local, throwaway Postgres instance — never against the actual live
Supabase project this app runs on. Applying a migration to the real project
(via `supabase db push`, or pasting the file into the Supabase Studio SQL
editor) is a manual step for whoever holds those credentials, and it has to
happen before the corresponding application code will work against the real
database. See [`DATABASE.md`](./DATABASE.md) for the full explanation and
exact steps.

## Bug fixes from the independent Phase 2.4/2.5 review

<a id="d31"></a>
### 31. `current_equity` was stale from the moment the first trade closed

`portfolios.current_equity` is written once, at portfolio creation/onboarding,
and was never updated after. `LogTradeModal`'s risk preview and the
standalone Risk Calculator (`risk-calculator.tsx`) both read that column
directly as "current account equity" for risk-percent position sizing. The
dashboard's own equity curve (`buildEquityCurve` in `index.tsx`) already
derived live equity correctly — `starting_equity` + closed-trade net
P&L — it just wasn't reused anywhere else. Fixed by computing that same
derivation once in `getWorkspace()` (one extra aggregate query, run in
parallel with the existing settings lookup) and exposing it as
`WorkspaceData.liveEquity`; both consumers now read that instead of the
stale column. The column itself is left in the schema (still meaningful as
"balance at onboarding") but nothing treats it as "current" anymore.

<a id="d32"></a>
### 32. Journal filtering and CSV export operate on the same filtered list

The Journal page had no search/filter controls at all, and CSV export
always dumped every trade regardless of what was visible — at odds with
Phase 2.5's own requirement for filtered export "for a selected period,
portfolio, or setup." Filtering (symbol search, status, curated/impulse
label, date range) is client-side over the already-fetched trade list, and
both the table and `exportCsv()` read the same `filteredTrades` value, so
what's on screen is always exactly what gets exported.

## Prop-firm compliance (Phase 2.4)

<a id="d33"></a>
### 33. Compliance math is realized-balance only — there is no floating P&L

This app has no live price feed, so "equity" for compliance purposes can
only ever mean `starting_equity` + net P&L of trades that have actually
closed. An open position's true mark-to-market P&L isn't known. Rather than
silently pretending otherwise, `prop-firm-calc.ts`'s module comment and the
compliance dashboard's banner both say this explicitly: the numbers shown
can understate real risk while a position is still open. `calculation_basis`
(`starting_balance` / `current_balance` / `high_water_mark`) governs the
*denominator* for daily-loss and drawdown percentages, not whether floating
P&L is included — it never is.

<a id="d34"></a>
### 34. Trading-day boundaries use `Intl.DateTimeFormat`, not a date library

The plan calls for day boundaries computed in the prop firm's own timezone.
Rather than add a dependency (date-fns-tz, luxon), `getTradingDayKey()` in
`prop-firm-calc.ts` uses `Intl.DateTimeFormat("en-CA", { timeZone })`, which
is built into JS, correctly handles DST transitions (it's asking "what
calendar date is this instant in this zone", not doing manual offset math),
and formats directly as `YYYY-MM-DD`. An invalid/unsupported IANA zone name
falls back to UTC rather than throwing, so a typo in the rule profile
doesn't take down the whole dashboard.

<a id="d35"></a>
### 35. Rule events are an upsert-with-ignoreDuplicates, not a manual existence check

`prop_firm_rule_events` has a `UNIQUE (portfolio_id, event_type,
occurred_on)` constraint specifically so recomputing compliance status on
every dashboard load — which happens on every page visit — can't spam
duplicate audit rows for a breach that's still ongoing. `getComplianceOverview`
just upserts every newly-detected event with `ignoreDuplicates: true` instead
of doing a manual "does this already exist" round trip first.

<a id="d36"></a>
### 36. No client-side lockout before logging a trade

The plan explicitly allows "optional soft lockouts" but is equally explicit
that a client-side lockout is not a security boundary. Rather than build a
lockout that a determined trader could just bypass (and that could
plausibly block a legitimate trade due to a bug), the compliance dashboard
surfaces daily-loss/drawdown/consistency warnings clearly and says outright
that nothing here blocks trade entry. Alerts, not enforcement.

## Sharing and reports (Phase 2.5)

<a id="d37"></a>
### 37. Coach shares are never exposed to RLS by an anon key — only the service role

`coach_shares` and `coach_comments` have RLS enabled with an owner-scoped
policy (same shape as every other table here) and nothing else — no
"anyone with the right token" anon policy. Expressing "not expired AND not
revoked AND don't leak whether a token exists at all on a miss" safely in
RLS is exactly the kind of thing RLS is bad at. Instead, the entire public
share path (`lib/public-share.functions.ts`) runs through
`supabaseAdmin` (the existing service-role client in
`client.server.ts`), dynamically imported inside each handler per that
file's own documented convention, after the handler validates the token,
expiry, and revocation itself. The anon key that ships to the browser never
has any path to these two tables at all.

<a id="d38"></a>
### 38. Every share-scoped query filters by owner_id *and* portfolio_id together

`coach_shares`' initial RLS policy only checked `auth.uid() = owner_id` on
write, without confirming the caller actually owns `portfolio_id` — since
service-role reads later trust `portfolio_id` alone, a share row that
somehow pointed at the wrong portfolio (a bug, not necessarily malice)
would leak another owner's trades to whoever held that link. Fixed in two
layers: the RLS policy now also requires `EXISTS (... portfolios WHERE
owner_id = auth.uid())` (matching `prop_firm_rules` and `period_reviews`),
and defensively, every query in `public-share.functions.ts` filters by both
`share.owner_id` and `share.portfolio_id` together rather than trusting
either one alone — `owner_id` is the source of truth everywhere else in
this schema and it stays that way here.

<a id="d39"></a>
### 39. Hiding dollar P&L redacts figures, not rows — and swaps the equity curve for R

When a share has `hide_dollar_pnl` set, the server strips dollar-denominated
fields (`netPnl`, `averageWin`/`averageLoss`, `expectancy`,
`maxDrawdownDollars`, per-trade `netPnl`) before the response ever leaves
the server — this isn't a client-side visual hide. Ratios that don't reveal
account size (win rate, profit factor, R multiples, drawdown *percent*)
still show, since a coach reviewing process quality needs those. The equity
curve itself would trivially reveal account size even without a dollar
axis label, so when dollars are hidden the same curve is redrawn as
cumulative R multiple instead — still a real progress line, no account size
implied.

<a id="d40"></a>
### 40. One report view serves both the owner's preview and the coach's link

`/share/$token` is the only report-rendering UI in the app. `/app/reports`
(share management: create, list, revoke, read comments) links out to it for
the "Preview" button rather than building a second, separate report layout
for the owner. Two report views that could drift apart from each other was
judged a worse outcome than the minor awkwardness of the owner "viewing
their own share link" to preview it.

<a id="d41"></a>
### 41. The printable report is a print stylesheet, not a generated PDF file

"PDF-ready" is implemented as `/share/$token` plus a `.no-print` CSS class
(buttons, the comment form) and a "Print / Save as PDF" button that calls
`window.print()` — the browser's own print-to-PDF does the file generation.
Generating an actual PDF file server-side would need a rendering dependency
(headless Chromium, or a PDF-layout library) for a result a print
stylesheet already achieves, and it would be a second place the report's
layout has to be kept in sync with `/share/$token` rather than one.

## Findings from a targeted quality review (hardcoding, races, polish)

Prompted by a direct report that the app felt "clunky" and that hardcoded
values and races "abound." Worth stating plainly: on inspection, the bulk of
the Phase 2.4/2.5 work above (decisions #31–41) held up well — RLS was used
correctly throughout, the stale-equity bug was already caught and fixed
before this review, and the rule-event dedup (#35) is more robust than a
naive implementation would be. The specific, real problems found are below;
this is a complete list of what changed in this pass, not a partial one.

<a id="d42"></a>
### 42. `coach_shares.view_count` had a real lost-update race

`getSharedReport` read `share.view_count` in one query, then wrote back
`share.view_count + 1` in a separate query several lines later. Two views
landing close together (two tabs, a bot and a real viewer) could both read
the same count and both write the same incremented value — one view
silently never gets counted. Fixed with a `SECURITY DEFINER` Postgres
function, `increment_share_view_count`, that does the arithmetic in a
single `UPDATE ... SET view_count = view_count + 1`, which is atomic with
respect to concurrent transactions; the application code now calls it via
`.rpc()` instead of reading, incrementing in JS, and writing back. See
`supabase/migrations/20260912090000_atomic_share_view_increment.sql`.

<a id="d43"></a>
### 43. Prop Rules' edit form went stale when the active portfolio changed

The portfolio switcher lives in the persistent sidebar, reachable from
every `/app` page — including Prop Rules. The form-population effect used
`setForm((current) => current ?? ...)` to avoid clobbering in-progress
edits, but that same guard meant switching portfolios never reloaded the
form at all: it kept showing the *previous* portfolio's rules. Since
`handleSubmit` saves using the *current* `portfolioId`, hitting Save after
switching portfolios would have silently written one portfolio's rule
profile onto another one's — a genuine correctness bug, not just a stale
display. Fixed by tracking which portfolio the form currently holds data
for (`formPortfolioId`) and reloading whenever it no longer matches the
active portfolio, so a same-portfolio edit is still preserved but a
portfolio switch always gets fresh data.

<a id="d44"></a>
### 44. Money and percentage figures on the three newest pages weren't monospace

Decision #2 established that every numeric figure in this app renders in
`font-mono` — but Prop Rules, Reports, and the shared report view
(`/share/$token`) were built without consistently following it: allowance
bars, balance/peak figures, view counts, and several numeric form inputs
were plain text. This is exactly the kind of thing that reads as "clunky"
sitting next to the rest of the app — the inconsistency is visible even if
no single instance is a bug. Fixed across all three files. `StatTile` and
`AllowanceBar`'s host `.metric-value` class already baked in `font-mono`,
so not every figure needed a manual fix — worth checking which convention
already covers a given spot before assuming it needs one.

<a id="d45"></a>
### 45. `<Button>` nested inside `<a>` in the Reports page's Preview link

Invalid HTML (a `<button>` element inside an `<a>` element) that happened
to render acceptably but risked inconsistent click/keyboard-focus behavior
across browsers. Fixed with the `asChild` pattern already used elsewhere in
the app (e.g. `settings.tsx`'s export link) — the Button's styling wraps
the actual `<a>` instead of a `<button>` nesting inside one.

<a id="d46"></a>
### 46. Form submit handlers gained explicit re-entry guards for consistency

The Prop Rules save form, the Reports share-creation form, and the shared
report's comment form all relied solely on a disabled submit button to
block double-submission — the same gap fixed in sign-in.tsx (#21) for a
much higher-stakes flow. These three are lower severity (an accidental
double-create or double-comment isn't damaging the way a duplicate signup
was), but the fix is the same one-line guard, and consistency here means
the next person extending any of these forms copies a safe pattern instead
of the gap.

<a id="d47"></a>
### 47. Journal is a layout route; edit is a visible row action; screenshots exist at creation time

Three user-reported breakages, one root cause each:

- **Trade detail page "didn't show up."** `routes/app/journal/$tradeId.tsx`
  is a child of `routes/app/journal.tsx` in the generated tree, but the
  parent rendered only the list and no `<Outlet />`, so a row click changed
  the URL while the list stayed on screen. `journal.tsx` now renders
  `<Outlet />` when `useChildMatches()` is non-empty and the list otherwise
  (chosen over moving the list to `journal/index.tsx` so `routeTree.gen.ts`
  and every existing `/app/journal` link stay untouched).
- **Logged trades couldn't be edited.** Edit lived only inside the row's "…"
  menu, and opening the edit Dialog from a *modal* Radix dropdown's
  `onSelect` leaves `pointer-events: none` on the page. The row now has a
  direct Edit button, the menu is `modal={false}`, and a failed save shows
  the server's message instead of a generic "could not be saved".
- **No screenshot area.** Uploads only rendered for an *existing* trade
  (`editingTradeId`), so "Log a trade" had none. `PendingScreenshotsPicker`
  stages files (picker or paste) and `journal.tsx` uploads them right after
  `createTrade`, via the shared `uploadTradeScreenshot`. A failed upload
  never rolls back the trade; it surfaces a separate notice.

<a id="d48"></a>
### 48. The redesign was done at the token/class layer, not per component

Components already referenced tokens (`bg-card`, `text-muted-foreground`,
`.surface-panel`, `.metric-value`, `font-mono`, `font-serif`), so "change the UI
totally" was done by rewriting `styles.css`, the shell in `routes/app.tsx`, the
landing page, and the UI primitives (`components/ui/*`: taller 36px controls,
larger radii, softer focus rings) rather than editing every page. Two
consequences worth knowing: (1) `font-mono` and `font-serif` now resolve to
real JetBrains Mono / Fraunces (they previously both pointed at Inter), and
`h1`–`h3` default to the serif in `@layer base`; (2) un-layered custom classes
beat Tailwind utilities, so a class that sets `display` (e.g. `.sidebar`)
cannot be toggled with `hidden` / `lg:hidden` on the same element — set
`display` only where that class is never combined with a visibility utility
(this is why `.equity-chip` has none).

<a id="d49"></a>
### 49. Theme is a `.dark` class on `<html>`, applied before first paint

`lib/theme.ts` stores the choice in localStorage (`ct-theme`, falling back to
the OS setting) and `__root.tsx` inlines a tiny script in `<head>` that applies
the class before React hydrates, so a dark-mode user never sees a light flash.
`useTheme()` only syncs React state from the DOM after mount, keeping server
and client markup identical.

<a id="d50"></a>
### 50. Position size is in lots (calculation v2)

The journal is primarily forex, so size is now entered and stored in
**lots**, not raw units, for every forex pair and for gold/silver (XAU/XAG).
`lib/instruments.ts` is the one place that knows what a symbol *is* — parsed
from the letters in the ticker (broker suffixes like `.m`/`_i` are stripped),
giving its contract size (100,000 for forex, 100 oz gold, 5,000 oz silver),
pip size, and base/quote currency:

```
P&L = price move × lots × contract size × (quote → account currency rate)
```

The quote → account rate is derived automatically for the common cases — 1
when the pair is quoted in the account's own currency (EURUSD on a USD
account), `1 / price` when the account currency is the base (USDJPY, USDCHF).
Only a genuine cross relative to the account (EURGBP, GBPJPY on a USD account)
needs a person-supplied rate; the log-trade modal and risk calculator both ask
for it inline and refuse to compute a preview without it, and `trades.quote_rate`
stores it so a later edit or partial exit recomputes correctly without asking
again. Crypto and anything the parser doesn't recognize (indices, single
stocks) stay sized in plain units, unchanged from before — brokers disagree
too much on contract size for those to guess safely.

**Why v2, not a silent reinterpretation of v1 data.** Existing trades were
entered as raw units (an EURUSD trade might read `quantity: 100000`).
Reinterpreting that number as lots would turn it into a 100,000-lot position,
so every `trades` row keeps a `calculation_version` (`"v1"` | `"v2"`) and
`isLegacyUnitQuantity()` in instruments.ts flags a v1 forex/metal row whose
stored quantity looks like units (≥ 1,000 for forex, ≥ 100 for gold/silver —
nobody trades that many lots). Those rows keep computing in raw units exactly
as before, in trade-calc, trade-exits and the analytics that read
`realized_r_multiple` / `net_pnl` directly. The size and pip-based numbers a
person actually *sees* still convert: the Journal table, the trade detail
page, and the edit form via `displaySize()`, so editing an old trade shows it
in lots and its size and any partial exits convert to lots (and the row
re-stamps to v2) the moment it's saved again — the one point where "convert on
touch" was safe to do quietly, because it's the same save that recomputes
everything else on that row anyway. CSV export always uses `displaySize()`, so
a re-imported export reads in lots too.

**Where this shows up:** the log-trade modal's size field, quote-rate field,
and risk preview; the risk calculator (now symbol-driven end to end instead of
a separate manual pip-size/pip-value mode); `PartialExitsPanel` (fills and the
"remaining" figure are lots, `unit` prop); the trade detail page's Position
size row; and the playbook "Convert to trade" quantity field.
