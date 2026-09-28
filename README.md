# Curated Trades

A focused trading journal for reviewing performance, discipline, and edge —
built with TanStack Start, React, TypeScript, Tailwind CSS, and Supabase.

**Current status:** Phase 1 and Phase 2.1–2.3 are built (auth, manual trade
capture, CSV import, dashboard, playbooks, post-trade review, and deeper
analytics). See [`docs/PHASE_STATUS.md`](./docs/PHASE_STATUS.md) for exactly
what's done against the original plan and what isn't yet.

## Documentation

- [`docs/PHASE_STATUS.md`](./docs/PHASE_STATUS.md) — what's built vs. not,
  phase by phase
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — how the pieces fit
  together
- [`docs/DATABASE.md`](./docs/DATABASE.md) — schema, RLS conventions, and
  **how to apply migrations to the real Supabase project** (a manual step —
  read this before assuming a new feature will work against production)
- [`docs/DECISIONS.md`](./docs/DECISIONS.md) — the non-obvious judgment
  calls made throughout the build, and why

## Stack

- **TanStack Start** (React 19, file-based routing, server functions)
- **Supabase** for auth, Postgres (RLS-scoped reads/writes via server
  functions), and Storage
- **Tailwind CSS v4** with a hand-built design system ("Studio" — warm
  paper/ink, light + dark themes, serif titles, mono figures; see `src/styles.css`)
- **decimal.js** for all financial math — see `src/lib/trade-calc.ts`
- **Zod** for input validation on every server function
- **Nitro** (`node-server` preset) for the server build/deploy target

## Development

```sh
pnpm install
pnpm dev
```

Requires a `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
(and `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` for the server-side auth
middleware — see `src/integrations/supabase/auth-middleware.ts`).

**Before running against a fresh Supabase project**, or after pulling a
change that adds a migration file, apply everything under
`supabase/migrations/` — see
[`docs/DATABASE.md`](./docs/DATABASE.md#applying-migrations)
for exact steps. This is not automatic.

## Architecture notes

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full picture.
The short version:

- **Calculation layer** (`src/lib/trade-calc.ts`): every P&L/R-multiple/risk
  calculation goes through here, using `Decimal` rather than raw JS floats.
  Manual entry, CSV import, and any future broker sync all funnel through the
  same functions so the numbers can never drift between entry paths.
- **Server functions** (`src/lib/*.functions.ts`): all reads/writes to
  Supabase happen here via `createServerFn`, gated by the `requireSupabaseAuth`
  middleware. Routes and components never call the Supabase client directly
  for anything privileged.
- **Auth and onboarding gating**: both happen in exactly one place,
  `src/routes/app.tsx` — see `docs/ARCHITECTURE.md` for why that matters and
  `docs/DECISIONS.md` #3 for the reasoning. The real security boundary is
  `requireSupabaseAuth` on each server function, not the client-side check.

## Scripts

- `pnpm dev` — start the dev server
- `pnpm build` — production build (also the fastest way to type-check
  route generation end-to-end)
- `pnpm preview` — preview a production build locally
- `pnpm format` — Prettier

There is currently no linter wired up — `typescript-eslint` doesn't yet
support the TypeScript version this project runs on. `tsc --noEmit` is the
type-checking gate in the meantime.

