// Account settings ("/app/settings"): profile fields, portfolio management
// (rename, create a new one, switch between them), account management
// within the active portfolio (rename, type, risk %, starting equity,
// create/archive/switch), and data export.
//
// Starting equity is only safe to edit while an account has zero logged
// trades — changing it afterward would retroactively rewrite the equity
// curve's starting point without touching any of the trades that already
// reference it, silently making every past dollar figure wrong. So this
// page checks for that per-account and locks the field, with an
// explanation, the moment a first trade exists. The server enforces the
// same check independently (see updateAccount) — this page's check is
// only there to give an honest disabled state, not the actual guarantee.
//
// The JSON export includes every trade and excludes attachments
// — both limits are stated plainly in the panel's own copy rather than
// hidden, since a silent partial export would be worse than an honest one.
//
// Page state lives in the URL (?section=, ?edit=<accountId>, ?add=portfolio|
// account) instead of component state, every form is a TanStack Form seeded
// straight from the loaded workspace (no sync-on-load effect), and the
// "saved" confirmations are sonner toasts.
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { saveAs } from "file-saver";
import { Archive, Briefcase, Database as DatabaseIcon, Download, FolderOpen, Layers, Pencil, Plus, User, UserCircle } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Database } from "@/integrations/supabase/types";
import { archiveAccount, createAccount, setActiveAccount, updateAccount } from "@/lib/accounts.functions";
import { formProps, useAppForm } from "@/lib/form";
import { formatMoney } from "@/lib/money";
import { createPortfolio, setActivePortfolio, updatePortfolio } from "@/lib/portfolios.functions";
import { updateProfile } from "@/lib/profile.functions";
import {
  queryKeys,
  tagsQueryOptions,
  tradeExistsQueryOptions,
  tradesQueryOptions,
  tradeTagLinksQueryOptions,
  workspaceQueryOptions,
} from "@/lib/queries";

type AccountRow = Database["public"]["Tables"]["accounts"]["Row"];

const SECTION_KEYS = ["profile", "portfolios", "accounts", "data"] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

export const Route = createFileRoute("/app/settings")({
  head: () => ({
    meta: [{ title: "Settings — Curated Trades" }],
  }),
  validateSearch: z.object({
    section: z.enum(SECTION_KEYS).optional(),
    /** Account id whose inline editor is open. */
    edit: z.string().optional(),
    /** Which "new …" form is open. */
    add: z.enum(["portfolio", "account"]).optional(),
  }),
  component: SettingsPage,
});

const TRADER_TYPES = [
  { value: "day", label: "Day trader" },
  { value: "scalp", label: "Scalper" },
  { value: "swing", label: "Swing trader" },
  { value: "position", label: "Position trader" },
] as const;

const COMMON_TIMEZONES = [
  "UTC",
  "Africa/Lagos",
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
];

const ACCOUNT_TYPE_OPTIONS = [
  { value: "personal", label: "Personal", icon: <User /> },
  { value: "prop", label: "Prop firm", icon: <Briefcase /> },
] as const;

const SECTIONS: { key: SectionKey; label: string; icon: typeof UserCircle }[] = [
  { key: "profile", label: "Profile", icon: UserCircle },
  { key: "portfolios", label: "Portfolios", icon: FolderOpen },
  { key: "accounts", label: "Accounts", icon: Layers },
  { key: "data", label: "Data & export", icon: DatabaseIcon },
];

const positiveNumber = (message: string) =>
  z.string().refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, message);
const currencyCode = z.string().trim().length(3, "Use a three-letter code, e.g. USD.");

/** A label-left / control-right row for the read-only rows (the editable
 * ones get the same layout from the form kit's `layout="row"`). */
function StaticRow({ label, hint, children }: { label: string; hint?: string | undefined; children: React.ReactNode }) {
  return (
    <div className="form-row">
      <div>
        <p className="form-row-label">{label}</p>
        {hint && <p className="form-row-hint">{hint}</p>}
      </div>
      <div className="max-w-md">{children}</div>
    </div>
  );
}

// ── Account editor (inline, under its table row) ───────────────────────────

const accountEditorSchema = z.object({
  name: z.string().trim().min(1, "Account name can't be empty"),
  accountType: z.enum(["personal", "prop"]),
  riskPercent: z.string().refine((value) => Number(value) > 0 && Number(value) <= 100, "Risk % must be between 0 and 100"),
  startingEquity: positiveNumber("Starting equity must be a positive number"),
});

function AccountEditor({ account, onSaved, onCancel }: { account: AccountRow; onSaved: () => void; onCancel: () => void }) {
  const { data: existingTrades } = useQuery(tradeExistsQueryOptions(account.id, account.portfolio_id));
  const hasTrades = (existingTrades?.length ?? 0) > 0;

  const update = useMutation({
    mutationFn: updateAccount,
    onSuccess: onSaved,
    onError: (error) => toast.error(error.message || "Couldn't save account"),
  });

  const form = useAppForm({
    defaultValues: {
      name: account.name,
      accountType: account.account_type === "prop" ? "prop" : "personal",
      riskPercent: String(account.default_risk_percent),
      startingEquity: String(account.starting_equity),
    } as z.infer<typeof accountEditorSchema>,
    validators: { onSubmit: accountEditorSchema },
    onSubmit: ({ value }) =>
      update.mutate({
        data: {
          accountId: account.id,
          name: value.name.trim(),
          accountType: value.accountType,
          defaultRiskPercent: Number(value.riskPercent),
          // Locked once trades exist — the server enforces it independently.
          ...(hasTrades ? {} : { startingEquity: Number(value.startingEquity) }),
        },
      }),
  });

  return (
    <form {...formProps(form)} className="border-t border-border bg-card">
      <form.AppField name="name">{(field) => <field.TextField layout="row" label="Account name" />}</form.AppField>
      <form.AppField name="accountType">
        {(field) => <field.SegmentedField layout="row" label="Account type" options={ACCOUNT_TYPE_OPTIONS} size="sm" />}
      </form.AppField>
      <form.AppField name="riskPercent">
        {(field) => (
          <field.TextField
            layout="row"
            label="Default risk per trade"
            hint="Percent of equity. Pre-fills the trade form and the risk calculator."
            type="number"
            step="0.1"
            min="0.1"
            max="100"
            className="w-28"
          />
        )}
      </form.AppField>
      {hasTrades ? (
        <StaticRow
          label="Starting equity"
          hint="Locked once an account has logged trades — changing it later would rewrite the equity curve's starting point without touching the trades that reference it."
        >
          <p className="font-mono text-[13px] font-semibold leading-8">{formatMoney(account.starting_equity, account.base_currency, 2)}</p>
        </StaticRow>
      ) : (
        <form.AppField name="startingEquity">
          {(field) => <field.TextField layout="row" label="Starting equity" type="number" step="any" min="1" className="w-40" />}
        </form.AppField>
      )}
      <div className="form-actions">
        <form.AppForm>
          <form.SubmitButton size="sm" pendingLabel="Saving…" pending={update.isPending}>
            Save account
          </form.SubmitButton>
        </form.AppForm>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── Profile ────────────────────────────────────────────────────────────────

const profileSchema = z.object({
  displayName: z.string(),
  timezone: z.string().min(1),
  baseCurrency: currencyCode,
  traderType: z.enum(["day", "scalp", "swing", "position"]),
});

function ProfileForm() {
  const queryClient = useQueryClient();
  const { data: workspace } = useSuspenseQuery(workspaceQueryOptions);
  const save = useMutation({
    mutationFn: updateProfile,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
      toast.success("Profile saved");
    },
    onError: () => toast.error("Couldn't save profile"),
  });
  const form = useAppForm({
    defaultValues: {
      displayName: workspace.profile.display_name ?? "",
      timezone: workspace.profile.timezone || "UTC",
      baseCurrency: workspace.profile.base_currency || "USD",
      traderType: TRADER_TYPES.find((t) => t.value === workspace.profile.trader_type)?.value ?? "swing",
    } as z.infer<typeof profileSchema>,
    validators: { onSubmit: profileSchema },
    onSubmit: ({ value }) =>
      save.mutate({
        data: {
          displayName: value.displayName.trim() || undefined,
          timezone: value.timezone,
          baseCurrency: value.baseCurrency,
          traderType: value.traderType,
        },
      }),
  });

  return (
    <form {...formProps(form)} className="surface-panel overflow-hidden p-0">
      <div className="panel-bar">
        <h2 className="panel-title">Profile</h2>
      </div>
      <form.AppField name="displayName">{(field) => <field.TextField layout="row" label="Display name" />}</form.AppField>
      <form.AppField name="timezone">
        {(field) => (
          <field.SelectField
            layout="row"
            label="Timezone"
            hint="Used to bucket trades into days and sessions."
            options={COMMON_TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
          />
        )}
      </form.AppField>
      <form.AppField
        name="baseCurrency"
        listeners={{ onChange: ({ value, fieldApi }) => fieldApi.setValue(value.toUpperCase(), { dontUpdateMeta: true }) }}
      >
        {(field) => (
          <field.TextField layout="row" label="Base currency" hint="Three-letter code, e.g. USD." className="w-28 uppercase" maxLength={3} />
        )}
      </form.AppField>
      <form.AppField name="traderType">
        {(field) => <field.SelectField layout="row" label="Trader type" options={TRADER_TYPES} />}
      </form.AppField>
      <div className="form-actions">
        <form.AppForm>
          <form.SubmitButton size="sm" pendingLabel="Saving…" pending={save.isPending}>
            Save profile
          </form.SubmitButton>
        </form.AppForm>
      </div>
    </form>
  );
}

// ── Portfolios ─────────────────────────────────────────────────────────────

const renameSchema = z.object({ name: z.string().trim().min(1, "Portfolio name can't be empty") });

function RenamePortfolioForm({ portfolioId, currentName }: { portfolioId: string; currentName: string }) {
  const queryClient = useQueryClient();
  const rename = useMutation({
    mutationFn: updatePortfolio,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
      toast.success("Portfolio renamed");
    },
    onError: () => toast.error("Couldn't rename portfolio"),
  });
  const form = useAppForm({
    defaultValues: { name: currentName },
    validators: { onSubmit: renameSchema },
    onSubmit: ({ value }) => rename.mutate({ data: { portfolioId, name: value.name.trim() } }),
  });
  return (
    <form {...formProps(form)} className="surface-panel overflow-hidden p-0">
      <div className="panel-bar">
        <h2 className="panel-title">Rename current portfolio</h2>
      </div>
      <form.AppField name="name">{(field) => <field.TextField layout="row" label="Portfolio name" />}</form.AppField>
      <div className="form-actions">
        <form.AppForm>
          <form.SubmitButton size="sm" pending={rename.isPending}>
            <Pencil /> Rename
          </form.SubmitButton>
        </form.AppForm>
      </div>
    </form>
  );
}

const newPortfolioSchema = z.object({
  name: z.string().trim().min(1, "Give the new portfolio a name"),
  currency: currencyCode,
  accountType: z.enum(["personal", "prop"]),
  equity: positiveNumber("Starting equity must be a positive number"),
});

function NewPortfolioForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: async (input: Parameters<typeof createPortfolio>[0]) => {
      const created = await createPortfolio(input);
      await setActivePortfolio({ data: { portfolioId: created.id } });
      return created;
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
      toast.success(`"${created.name}" created and switched to it`);
      onDone();
    },
    onError: () => toast.error("Couldn't create portfolio"),
  });
  const form = useAppForm({
    defaultValues: { name: "", currency: "USD", accountType: "personal", equity: "50000" } as z.infer<typeof newPortfolioSchema>,
    validators: { onSubmit: newPortfolioSchema },
    onSubmit: ({ value }) =>
      create.mutate({
        data: { name: value.name.trim(), accountType: value.accountType, baseCurrency: value.currency, startingEquity: Number(value.equity) },
      }),
  });
  return (
    <form {...formProps(form)} className="surface-panel overflow-hidden p-0">
      <div className="panel-bar">
        <h2 className="panel-title">New portfolio</h2>
      </div>
      <form.AppField name="name">{(field) => <field.TextField layout="row" label="Name" />}</form.AppField>
      <form.AppField
        name="currency"
        listeners={{ onChange: ({ value, fieldApi }) => fieldApi.setValue(value.toUpperCase(), { dontUpdateMeta: true }) }}
      >
        {(field) => <field.TextField layout="row" label="Currency" className="w-28 uppercase" maxLength={3} />}
      </form.AppField>
      <form.AppField name="accountType">
        {(field) => <field.SegmentedField layout="row" label="First account's type" options={ACCOUNT_TYPE_OPTIONS} size="sm" />}
      </form.AppField>
      <form.AppField name="equity">
        {(field) => (
          <field.TextField layout="row" label="First account's starting equity" type="number" step="any" min="1" className="w-40" />
        )}
      </form.AppField>
      <div className="form-actions">
        <form.AppForm>
          <form.SubmitButton size="sm" pendingLabel="Creating…" pending={create.isPending}>
            Create portfolio
          </form.SubmitButton>
        </form.AppForm>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── Accounts ───────────────────────────────────────────────────────────────

const newAccountSchema = z.object({
  name: z.string().trim().min(1, "Give the new account a name"),
  accountType: z.enum(["personal", "prop"]),
  equity: positiveNumber("Starting equity must be a positive number"),
});

function NewAccountForm({ portfolioId, onDone }: { portfolioId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: createAccount,
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
      toast.success(`"${created.name}" account created`);
      onDone();
    },
    onError: () => toast.error("Couldn't create account"),
  });
  const form = useAppForm({
    defaultValues: { name: "", accountType: "personal", equity: "10000" } as z.infer<typeof newAccountSchema>,
    validators: { onSubmit: newAccountSchema },
    onSubmit: ({ value }) =>
      create.mutate({
        data: { portfolioId, name: value.name.trim(), accountType: value.accountType, startingEquity: Number(value.equity) },
      }),
  });
  return (
    <form {...formProps(form)} className="surface-panel overflow-hidden p-0">
      <div className="panel-bar">
        <h2 className="panel-title">New account</h2>
      </div>
      <form.AppField name="name">{(field) => <field.TextField layout="row" label="Name" />}</form.AppField>
      <form.AppField name="accountType">
        {(field) => <field.SegmentedField layout="row" label="Account type" options={ACCOUNT_TYPE_OPTIONS} size="sm" />}
      </form.AppField>
      <form.AppField name="equity">
        {(field) => <field.TextField layout="row" label="Starting equity" type="number" step="any" min="1" className="w-40" />}
      </form.AppField>
      <div className="form-actions">
        <form.AppForm>
          <form.SubmitButton size="sm" pendingLabel="Creating…" pending={create.isPending}>
            Create account
          </form.SubmitButton>
        </form.AppForm>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

function SettingsPage() {
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const section = search.section ?? "profile";
  const { data: workspace } = useSuspenseQuery(workspaceQueryOptions);

  const invalidateWorkspace = () => queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
  const setSearch = (patch: { section?: SectionKey | undefined; edit?: string | undefined; add?: "portfolio" | "account" | undefined }) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const switchPortfolioMutation = useMutation({
    mutationFn: (portfolioId: string) => setActivePortfolio({ data: { portfolioId } }),
    onSuccess: invalidateWorkspace,
  });

  const switchAccountMutation = useMutation({
    mutationFn: (accountId: string | null) => setActiveAccount({ data: { portfolioId: workspace.activePortfolio.id, accountId } }),
    onSuccess: invalidateWorkspace,
  });

  const archiveAccountMutation = useMutation({
    mutationFn: archiveAccount,
    onSuccess: () => {
      void invalidateWorkspace();
      toast.success("Account archived");
    },
    onError: () => toast.error("Couldn't archive account"),
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const portfolioId = workspace.activePortfolio.id;
      // Through the query cache: reuses whatever the Journal already loaded.
      const [trades, tagLinks, tags] = await Promise.all([
        queryClient.fetchQuery(tradesQueryOptions(portfolioId, undefined)),
        queryClient.fetchQuery(tradeTagLinksQueryOptions(portfolioId)),
        queryClient.fetchQuery(tagsQueryOptions),
      ]);

      const tagNameById = new Map(tags.map((tag) => [tag.id, tag.name]));
      const tagNamesByTrade = new Map<string, string[]>();
      for (const link of tagLinks) {
        tagNamesByTrade.set(link.trade_id, [
          ...(tagNamesByTrade.get(link.trade_id) ?? []),
          tagNameById.get(link.tag_id) ?? link.tag_id,
        ]);
      }

      const payload = {
        exportedAt: new Date().toISOString(),
        profile: workspace.profile,
        portfolios: workspace.portfolios,
        activePortfolioId: portfolioId,
        accounts: workspace.accounts,
        tags,
        trades: trades.map((trade) => ({ ...trade, tags: tagNamesByTrade.get(trade.id) ?? [] })),
      };
      saveAs(
        new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
        `curated-trades-export-${new Date().toISOString().slice(0, 10)}.json`,
      );
    },
    onSuccess: () => toast.success("Export downloaded"),
    onError: () => toast.error("Couldn't build export"),
  });

  const activeAccountId = workspace.activeAccount?.id ?? null;

  return (
    <>
      <section className="mb-5">
        <h1 className="page-title">Settings</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Profile, portfolios, accounts and data export.</p>
      </section>

      <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start">
        <nav className="section-nav" aria-label="Settings sections">
          {SECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`section-nav-item ${section === item.key ? "section-nav-item-active" : ""}`}
              onClick={() => setSearch({ section: item.key, edit: undefined, add: undefined })}
              aria-current={section === item.key ? "page" : undefined}
            >
              <item.icon />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-5">
          {section === "profile" && <ProfileForm />}

          {section === "portfolios" && (
            <>
              <div className="surface-panel overflow-hidden p-0">
                <div className="panel-bar">
                  <h2 className="panel-title">Portfolios</h2>
                  {search.add !== "portfolio" && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setSearch({ add: "portfolio" })}>
                      <Plus /> New portfolio
                    </Button>
                  )}
                </div>
                <div className="trade-table-wrap">
                  <table className="trade-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Status</th>
                        <th className="num">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workspace.portfolios.map((portfolio) => {
                        const isCurrent = portfolio.id === workspace.activePortfolio.id;
                        return (
                          <tr key={portfolio.id}>
                            <td className="font-medium">{portfolio.name}</td>
                            <td>{isCurrent ? <Badge>Current</Badge> : <span className="text-muted-foreground">—</span>}</td>
                            <td className="num">
                              {!isCurrent && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={switchPortfolioMutation.isPending}
                                  onClick={() => switchPortfolioMutation.mutate(portfolio.id)}
                                >
                                  Switch to
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Keyed so switching portfolios re-seeds the field. */}
              <RenamePortfolioForm
                key={workspace.activePortfolio.id}
                portfolioId={workspace.activePortfolio.id}
                currentName={workspace.activePortfolio.name}
              />

              {search.add === "portfolio" && <NewPortfolioForm onDone={() => setSearch({ add: undefined })} />}
            </>
          )}

          {section === "accounts" && (
            <>
              <div className="surface-panel overflow-hidden p-0">
                <div className="panel-bar">
                  <h2 className="panel-title">Accounts in "{workspace.activePortfolio.name}"</h2>
                  {search.add !== "account" && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setSearch({ add: "account" })}>
                      <Plus /> New account
                    </Button>
                  )}
                </div>
                <p className="border-b border-border px-4 py-2.5 text-xs leading-5 text-muted-foreground">
                  Each account has its own equity, risk % and prop-firm rules — the unit trades and compliance are tracked
                  against. "All accounts" aggregates the portfolio: financial totals sum across accounts, but compliance is never
                  merged.
                </p>
                <div className="trade-table-wrap">
                  <table className="trade-table">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Type</th>
                        <th className="num">Risk / trade</th>
                        <th className="num">Starting equity</th>
                        <th>Status</th>
                        <th className="num">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="font-medium">All accounts (aggregate)</td>
                        <td className="text-muted-foreground">—</td>
                        <td className="num text-muted-foreground">—</td>
                        <td className="num text-muted-foreground">—</td>
                        <td>{activeAccountId == null ? <Badge>Current</Badge> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="num">
                          {activeAccountId != null && (
                            <Button type="button" variant="outline" size="sm" disabled={switchAccountMutation.isPending} onClick={() => switchAccountMutation.mutate(null)}>
                              Switch to
                            </Button>
                          )}
                        </td>
                      </tr>
                      {workspace.accounts.flatMap((account) => {
                        const isCurrent = account.id === activeAccountId;
                        const isEditing = search.edit === account.id;
                        const rows = [
                          <tr key={account.id}>
                            <td className="font-medium">{account.name}</td>
                            <td>
                              <Badge variant={account.account_type === "prop" ? "default" : "secondary"} className="capitalize">
                                {account.account_type}
                              </Badge>
                            </td>
                            <td className="num font-mono">{account.default_risk_percent}%</td>
                            <td className="num font-mono">{formatMoney(account.starting_equity, account.base_currency)}</td>
                            <td>{isCurrent ? <Badge>Current</Badge> : <span className="text-muted-foreground">—</span>}</td>
                            <td className="num">
                              <div className="flex items-center justify-end gap-1">
                                {!isCurrent && (
                                  <Button type="button" variant="outline" size="sm" disabled={switchAccountMutation.isPending} onClick={() => switchAccountMutation.mutate(account.id)}>
                                    Switch to
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label="Edit account"
                                  title="Edit account"
                                  onClick={() => setSearch({ edit: isEditing ? undefined : account.id })}
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                                {workspace.accounts.length > 1 && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Archive account"
                                    title="Archive account"
                                    onClick={() => {
                                      if (window.confirm(`Archive "${account.name}"? Its trades and history stay intact, but it leaves every switcher and picker.`)) {
                                        archiveAccountMutation.mutate({ data: { accountId: account.id } });
                                      }
                                    }}
                                  >
                                    <Archive className="size-3.5" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>,
                        ];
                        if (isEditing) {
                          rows.push(
                            <tr key={`${account.id}-editor`}>
                              <td colSpan={6} className="!whitespace-normal !bg-card !p-0">
                                <AccountEditor
                                  account={account}
                                  onCancel={() => setSearch({ edit: undefined })}
                                  onSaved={() => {
                                    void invalidateWorkspace();
                                    setSearch({ edit: undefined });
                                    toast.success("Account saved");
                                  }}
                                />
                              </td>
                            </tr>,
                          );
                        }
                        return rows;
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {search.add === "account" && (
                <NewAccountForm portfolioId={workspace.activePortfolio.id} onDone={() => setSearch({ add: undefined })} />
              )}
            </>
          )}

          {section === "data" && (
            <div className="surface-panel overflow-hidden p-0">
              <div className="panel-bar">
                <h2 className="panel-title">Data & export</h2>
              </div>
              <StaticRow
                label="Full export (JSON)"
                hint="Profile, portfolios, accounts, tags and every trade in this portfolio. Uploaded attachments (screenshots) aren't included."
              >
                <Button type="button" variant="outline" size="sm" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
                  <Download /> {exportMutation.isPending ? "Preparing…" : "Download JSON"}
                </Button>
              </StaticRow>
              <StaticRow label="Filtered CSV export" hint="Export a filtered set of trades from the Journal.">
                <Link to="/app/journal" className="text-[13px] font-medium text-primary hover:underline">
                  Open the Journal
                </Link>
              </StaticRow>
              <StaticRow label="Delete account" hint="Account deletion is planned for a later phase — reach out directly if you need it.">
                <span className="text-[13px] text-muted-foreground">Not available yet</span>
              </StaticRow>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
