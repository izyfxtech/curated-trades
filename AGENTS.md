# Agent notes for this repo

- **Package manager**: pnpm. Use `pnpm install` / `pnpm add` / `pnpm run <script>`
  — don't reach for npm or yarn, and don't commit a second lockfile.
- **No ESLint**: removed because `typescript-eslint` doesn't yet support the
  TypeScript version in use here (see `package.json`). `npm run build` (which
  runs `tsc` as part of route generation) plus `npx tsc --noEmit` are the
  type-checking gates. Prettier (`npm run format`) still runs independently.
- **Financial math always goes through `src/lib/trade-calc.ts`.** Never
  compute P&L, R-multiples, risk, or drawdown with raw JS floats inline —
  add or extend a function in that file instead. Analytics breakdowns
  (`src/lib/analytics.ts`) call into this file rather than reimplementing
  any of its math — follow that pattern for new analytics work too.
- **Server functions, not direct client calls.** Any read/write to Supabase
  that isn't the auth session itself belongs in `src/lib/*.functions.ts`,
  using `createServerFn` + the `requireSupabaseAuth` middleware. Routes and
  components should not import the Supabase client for privileged data.
- **Ownership checks: prefer RLS + an explicit `owner_id` filter over a
  separate pre-check SELECT**, translating the resulting "no rows"/RLS
  rejection into a friendly message via `src/lib/db-errors.ts` — see
  `docs/DECISIONS.md` #27. Before removing a pre-check on an existing
  function, or skipping one on a new one, actually read the table's RLS
  policy in `supabase/migrations/` to confirm it enforces what you're
  relying on — don't assume. The one deliberate exception is
  `import.functions.ts`, which keeps its pre-check since a bad
  `portfolioId` there would otherwise fail inside a loop of up to 2000 rows
  instead of once, up front.
- **Migrations must be idempotent** — every file under `supabase/migrations/`
  needs to apply cleanly when re-run. See `docs/DATABASE.md` for the exact
  patterns (`IF NOT EXISTS`, drop-then-recreate for policies/triggers, a
  `DO` block catching both `duplicate_object` and `duplicate_table` for
  constraints) and how to test a new migration against a disposable local
  Postgres before committing it. **Nothing in this repo can apply a
  migration to the actual Supabase project** — that's a manual step for
  whoever holds those credentials; don't assume a new migration file has
  taken effect anywhere just because it's in the repo.
- **After adding/moving routes**, run `npm run build` once to let the
  `@tanstack/router-plugin` regenerate `src/routeTree.gen.ts` before trusting
  route-related type errors.
- **Every source file should open with a short header comment** explaining
  its purpose and any non-obvious design choice specific to it — this repo
  is written to be handed to a team who won't have the context behind why
  something is built the way it is. When you make a similarly non-obvious
  call, add it to `docs/DECISIONS.md` (numbered, in the relevant section)
  rather than leaving the reasoning only in a commit message or comment.
- **Multi-line `str_replace` edits near the top of a file are risky** — if
  `old_str` includes several import lines and `new_str` only reproduces
  some of them, the rest silently disappear with no error. Prefer matching
  a single line (e.g. just the `createFileRoute` import) as the anchor when
  inserting a header comment, and always re-run `tsc --noEmit` immediately
  after any edit near a file's imports.

