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
// The JSON export intentionally caps at 500 trades and excludes attachments
// — both limits are stated plainly in the panel's own copy rather than
// hidden, since a silent partial export would be worse than an honest one.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Archive, Briefcase, Check, Database as DatabaseIcon, Download, FolderOpen, Layers, Pencil, Plus, User, UserCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { archiveAccount, createAccount, setActiveAccount, updateAccount } from "@/lib/accounts.functions";
import { createPortfolio, getWorkspace, setActivePortfolio, updatePortfolio } from "@/lib/portfolios.functions";
import { updateProfile } from "@/lib/profile.functions";
import { listTags } from "@/lib/tags.functions";
import { listTrades, listTradeTagLinks, TRADES_LIST_DEFAULT_LIMIT } from "@/lib/trades.functions";
import type { Database } from "@/integrations/supabase/types";

type AccountRow = Database["public"]["Tables"]["accounts"]["Row"];

export const Route = createFileRoute("/app/settings")({
  head: () => ({
    meta: [{ title: "Settings — Curated Trades" }],
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

type AccountType = "personal" | "prop";
type SectionKey = "profile" | "portfolios" | "accounts" | "data";

const SECTIONS: { key: SectionKey; label: string; icon: typeof UserCircle }[] = [
  { key: "profile", label: "Profile", icon: UserCircle },
  { key: "portfolios", label: "Portfolios", icon: FolderOpen },
  { key: "accounts", label: "Accounts", icon: Layers },
  { key: "data", label: "Data & export", icon: DatabaseIcon },
];

function money(value: number) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/** A label-left / control-right row, the layout every traditional journal's settings use. */
function FormRow({ label, hint, htmlFor, children }: { label: string; hint?: string | undefined; htmlFor?: string | undefined; children: ReactNode }) {
  return (
    <div className="form-row">
      <div>
        <label htmlFor={htmlFor} className="form-row-label">
          {label}
        </label>
        {hint && <p className="form-row-hint">{hint}</p>}
      </div>
      <div className="max-w-md">{children}</div>
    </div>
  );
}

function TypeToggle({ value, onChange }: { value: AccountType; onChange: (value: AccountType) => void }) {
  return (
    <div className="direction-toggle">
      <Button type="button" variant={value === "personal" ? "secondary" : "ghost"} size="sm" onClick={() => onChange("personal")}>
        <User /> Personal
      </Button>
      <Button type="button" variant={value === "prop" ? "secondary" : "ghost"} size="sm" onClick={() => onChange("prop")}>
        <Briefcase /> Prop firm
      </Button>
    </div>
  );
}

function AccountEditor({ account, onSaved, onCancel }: { account: AccountRow; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(account.name);
  const [accountType, setAccountType] = useState<AccountType>(account.account_type === "prop" ? "prop" : "personal");
  const [riskPercent, setRiskPercent] = useState(String(account.default_risk_percent));
  const [startingEquity, setStartingEquity] = useState(String(account.starting_equity));
  const [notice, setNotice] = useState("");

  const tradeExistsQuery = useQuery({
    queryKey: ["trade-exists", account.id],
    queryFn: () => listTrades({ data: { portfolioId: account.portfolio_id, accountId: account.id, limit: 1 } }),
  });
  const hasTrades = (tradeExistsQuery.data?.length ?? 0) > 0;

  const updateMutation = useMutation({
    mutationFn: updateAccount,
    onSuccess: onSaved,
    onError: (error) => setNotice(error instanceof Error ? error.message : "Couldn't save account"),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const risk = Number(riskPercent);
    if (!Number.isFinite(risk) || risk <= 0 || risk > 100) {
      setNotice("Risk % must be between 0 and 100");
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNotice("Account name can't be empty");
      return;
    }
    let equity: number | undefined;
    if (!hasTrades) {
      equity = Number(startingEquity);
      if (!Number.isFinite(equity) || equity <= 0) {
        setNotice("Starting equity must be a positive number");
        return;
      }
    }
    updateMutation.mutate({
      data: {
        accountId: account.id,
        name: trimmedName,
        accountType,
        defaultRiskPercent: risk,
        ...(equity != null ? { startingEquity: equity } : {}),
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-border bg-card">
      {notice && <p className="px-4 pt-3 text-xs text-destructive">{notice}</p>}
      <FormRow label="Account name" htmlFor={`account-name-${account.id}`}>
        <Input id={`account-name-${account.id}`} value={name} onChange={(e) => setName(e.target.value)} />
      </FormRow>
      <FormRow label="Account type">
        <TypeToggle value={accountType} onChange={setAccountType} />
      </FormRow>
      <FormRow label="Default risk per trade" hint="Percent of equity. Pre-fills the trade form and the risk calculator." htmlFor={`account-risk-${account.id}`}>
        <div className="flex items-center gap-2">
          <Input
            id={`account-risk-${account.id}`}
            type="number"
            step="0.1"
            min="0.1"
            max="100"
            className="w-28"
            value={riskPercent}
            onChange={(e) => setRiskPercent(e.target.value)}
          />
          <span className="text-muted-foreground">%</span>
        </div>
      </FormRow>
      <FormRow
        label="Starting equity"
        hint={
          hasTrades
            ? "Locked once an account has logged trades — changing it later would rewrite the equity curve's starting point without touching the trades that reference it."
            : undefined
        }
        htmlFor={`account-equity-${account.id}`}
      >
        {hasTrades ? (
          <p className="font-mono text-[13px] font-semibold leading-8">{money(account.starting_equity)}</p>
        ) : (
          <Input
            id={`account-equity-${account.id}`}
            type="number"
            step="any"
            min="1"
            className="w-40"
            value={startingEquity}
            onChange={(e) => setStartingEquity(e.target.value)}
          />
        )}
      </FormRow>
      <div className="form-actions">
        <Button type="submit" size="sm" disabled={updateMutation.isPending}>
          {updateMutation.isPending ? "Saving…" : "Save account"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => getWorkspace() });
  const workspace = workspaceQuery.data;

  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [baseCurrency, setBaseCurrency] = useState("USD");
  const [traderType, setTraderType] = useState<(typeof TRADER_TYPES)[number]["value"]>("swing");
  const [portfolioName, setPortfolioName] = useState("");
  const [notice, setNotice] = useState("");
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [section, setSection] = useState<SectionKey>("profile");

  const [isAddingPortfolio, setIsAddingPortfolio] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAccountType, setNewAccountType] = useState<AccountType>("personal");
  const [newCurrency, setNewCurrency] = useState("USD");
  const [newEquity, setNewEquity] = useState("50000");

  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountType2, setNewAccountType2] = useState<AccountType>("personal");
  const [newAccountEquity, setNewAccountEquity] = useState("10000");

  useEffect(() => {
    if (!workspace) return;
    setDisplayName(workspace.profile.display_name ?? "");
    setTimezone(workspace.profile.timezone || "UTC");
    setBaseCurrency(workspace.profile.base_currency || "USD");
    const validType = TRADER_TYPES.find((t) => t.value === workspace.profile.trader_type);
    setTraderType(validType?.value ?? "swing");
    setPortfolioName(workspace.activePortfolio.name);
  }, [workspace]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  }

  function invalidateWorkspace() {
    void queryClient.invalidateQueries({ queryKey: ["workspace"] });
  }

  const profileMutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: () => {
      invalidateWorkspace();
      showNotice("Profile saved");
    },
    onError: () => showNotice("Couldn't save profile"),
  });

  const portfolioNameMutation = useMutation({
    mutationFn: updatePortfolio,
    onSuccess: () => {
      invalidateWorkspace();
      showNotice("Portfolio renamed");
    },
    onError: () => showNotice("Couldn't rename portfolio"),
  });

  const createPortfolioMutation = useMutation({
    mutationFn: createPortfolio,
    onSuccess: async (created) => {
      await setActivePortfolio({ data: { portfolioId: created.id } });
      invalidateWorkspace();
      setIsAddingPortfolio(false);
      setNewName("");
      setNewEquity("50000");
      showNotice(`"${created.name}" created and switched to it`);
    },
    onError: () => showNotice("Couldn't create portfolio"),
  });

  const switchPortfolioMutation = useMutation({
    mutationFn: (portfolioId: string) => setActivePortfolio({ data: { portfolioId } }),
    onSuccess: invalidateWorkspace,
  });

  const switchAccountMutation = useMutation({
    mutationFn: (accountId: string | null) => setActiveAccount({ data: { portfolioId: workspace!.activePortfolio.id, accountId } }),
    onSuccess: invalidateWorkspace,
  });

  const createAccountMutation = useMutation({
    mutationFn: createAccount,
    onSuccess: (created) => {
      invalidateWorkspace();
      setIsAddingAccount(false);
      setNewAccountName("");
      setNewAccountEquity("10000");
      showNotice(`"${created.name}" account created`);
    },
    onError: () => showNotice("Couldn't create account"),
  });

  const archiveAccountMutation = useMutation({
    mutationFn: archiveAccount,
    onSuccess: () => {
      invalidateWorkspace();
      showNotice("Account archived");
    },
    onError: () => showNotice("Couldn't archive account"),
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!workspace) throw new Error("Workspace not loaded");

      const [trades, tagLinks, tags] = await Promise.all([
        listTrades({ data: { portfolioId: workspace.activePortfolio.id, limit: TRADES_LIST_DEFAULT_LIMIT } }),
        listTradeTagLinks({ data: { portfolioId: workspace.activePortfolio.id } }),
        listTags(),
      ]);

      const tagNameById = new Map(tags.map((tag) => [tag.id, tag.name]));
      const tagIdsByTrade = new Map<string, string[]>();
      for (const link of tagLinks) {
        const list = tagIdsByTrade.get(link.trade_id) ?? [];
        list.push(tagNameById.get(link.tag_id) ?? link.tag_id);
        tagIdsByTrade.set(link.trade_id, list);
      }

      const payload = {
        exportedAt: new Date().toISOString(),
        profile: workspace.profile,
        portfolios: workspace.portfolios,
        activePortfolioId: workspace.activePortfolio.id,
        accounts: workspace.accounts,
        tags,
        trades: trades.map((trade) => ({ ...trade, tags: tagIdsByTrade.get(trade.id) ?? [] })),
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `curated-trades-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => showNotice("Export downloaded"),
    onError: () => showNotice("Couldn't build export"),
  });

  function onSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    profileMutation.mutate({
      data: { displayName: displayName.trim() || undefined, timezone, baseCurrency, traderType },
    });
  }

  function onRenamePortfolio(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    const name = portfolioName.trim();
    if (!name) {
      showNotice("Portfolio name can't be empty");
      return;
    }
    portfolioNameMutation.mutate({ data: { portfolioId: workspace.activePortfolio.id, name } });
  }

  function onCreatePortfolio(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    const equity = Number(newEquity);
    if (!name) {
      showNotice("Give the new portfolio a name");
      return;
    }
    if (!Number.isFinite(equity) || equity <= 0) {
      showNotice("Starting equity must be a positive number");
      return;
    }
    createPortfolioMutation.mutate({ data: { name, accountType: newAccountType, baseCurrency: newCurrency, startingEquity: equity } });
  }

  function onCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    const name = newAccountName.trim();
    const equity = Number(newAccountEquity);
    if (!name) {
      showNotice("Give the new account a name");
      return;
    }
    if (!Number.isFinite(equity) || equity <= 0) {
      showNotice("Starting equity must be a positive number");
      return;
    }
    createAccountMutation.mutate({
      data: { portfolioId: workspace.activePortfolio.id, name, accountType: newAccountType2, startingEquity: equity },
    });
  }

  if (workspaceQuery.isLoading || !workspace) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading settings…</p>;
  }

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
              onClick={() => setSection(item.key)}
              aria-current={section === item.key ? "page" : undefined}
            >
              <item.icon />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-5">
          {section === "profile" && (
            <form onSubmit={onSaveProfile} className="surface-panel overflow-hidden p-0">
              <div className="panel-bar">
                <h2 className="panel-title">Profile</h2>
              </div>
              <FormRow label="Display name" htmlFor="settings-name">
                <Input id="settings-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </FormRow>
              <FormRow label="Timezone" hint="Used to bucket trades into days and sessions.">
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormRow>
              <FormRow label="Base currency" hint="Three-letter code, e.g. USD." htmlFor="settings-currency">
                <Input id="settings-currency" className="w-28 uppercase" value={baseCurrency} maxLength={3} onChange={(e) => setBaseCurrency(e.target.value.toUpperCase())} />
              </FormRow>
              <FormRow label="Trader type">
                <Select value={traderType} onValueChange={(v: (typeof TRADER_TYPES)[number]["value"]) => setTraderType(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRADER_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormRow>
              <div className="form-actions">
                <Button type="submit" size="sm" disabled={profileMutation.isPending}>
                  {profileMutation.isPending ? "Saving…" : "Save profile"}
                </Button>
              </div>
            </form>
          )}

          {section === "portfolios" && (
            <>
              <div className="surface-panel overflow-hidden p-0">
                <div className="panel-bar">
                  <h2 className="panel-title">Portfolios</h2>
                  {!isAddingPortfolio && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsAddingPortfolio(true)}>
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

              <form onSubmit={onRenamePortfolio} className="surface-panel overflow-hidden p-0">
                <div className="panel-bar">
                  <h2 className="panel-title">Rename current portfolio</h2>
                </div>
                <FormRow label="Portfolio name" htmlFor="settings-portfolio-name">
                  <Input id="settings-portfolio-name" value={portfolioName} onChange={(e) => setPortfolioName(e.target.value)} />
                </FormRow>
                <div className="form-actions">
                  <Button type="submit" size="sm" disabled={portfolioNameMutation.isPending}>
                    <Pencil /> Rename
                  </Button>
                </div>
              </form>

              {isAddingPortfolio && (
                <form onSubmit={onCreatePortfolio} className="surface-panel overflow-hidden p-0">
                  <div className="panel-bar">
                    <h2 className="panel-title">New portfolio</h2>
                  </div>
                  <FormRow label="Name" htmlFor="new-portfolio-name">
                    <Input id="new-portfolio-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                  </FormRow>
                  <FormRow label="Currency" htmlFor="new-portfolio-currency">
                    <Input id="new-portfolio-currency" className="w-28 uppercase" value={newCurrency} maxLength={3} onChange={(e) => setNewCurrency(e.target.value.toUpperCase())} />
                  </FormRow>
                  <FormRow label="First account's type">
                    <TypeToggle value={newAccountType} onChange={setNewAccountType} />
                  </FormRow>
                  <FormRow label="First account's starting equity" htmlFor="new-portfolio-equity">
                    <Input id="new-portfolio-equity" type="number" step="any" min="1" className="w-40" value={newEquity} onChange={(e) => setNewEquity(e.target.value)} />
                  </FormRow>
                  <div className="form-actions">
                    <Button type="submit" size="sm" disabled={createPortfolioMutation.isPending}>
                      {createPortfolioMutation.isPending ? "Creating…" : "Create portfolio"}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setIsAddingPortfolio(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </>
          )}

          {section === "accounts" && (
            <>
              <div className="surface-panel overflow-hidden p-0">
                <div className="panel-bar">
                  <h2 className="panel-title">Accounts in "{workspace.activePortfolio.name}"</h2>
                  {!isAddingAccount && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsAddingAccount(true)}>
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
                        const isEditing = editingAccountId === account.id;
                        const rows = [
                          <tr key={account.id}>
                            <td className="font-medium">{account.name}</td>
                            <td>
                              <Badge variant={account.account_type === "prop" ? "default" : "secondary"} className="capitalize">
                                {account.account_type}
                              </Badge>
                            </td>
                            <td className="num font-mono">{account.default_risk_percent}%</td>
                            <td className="num font-mono">{money(account.starting_equity)}</td>
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
                                  onClick={() => setEditingAccountId(isEditing ? null : account.id)}
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
                                  onCancel={() => setEditingAccountId(null)}
                                  onSaved={() => {
                                    invalidateWorkspace();
                                    setEditingAccountId(null);
                                    showNotice("Account saved");
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

              {isAddingAccount && (
                <form onSubmit={onCreateAccount} className="surface-panel overflow-hidden p-0">
                  <div className="panel-bar">
                    <h2 className="panel-title">New account</h2>
                  </div>
                  <FormRow label="Name" htmlFor="new-account-name">
                    <Input id="new-account-name" value={newAccountName} onChange={(e) => setNewAccountName(e.target.value)} />
                  </FormRow>
                  <FormRow label="Account type">
                    <TypeToggle value={newAccountType2} onChange={setNewAccountType2} />
                  </FormRow>
                  <FormRow label="Starting equity" htmlFor="new-account-equity">
                    <Input id="new-account-equity" type="number" step="any" min="1" className="w-40" value={newAccountEquity} onChange={(e) => setNewAccountEquity(e.target.value)} />
                  </FormRow>
                  <div className="form-actions">
                    <Button type="submit" size="sm" disabled={createAccountMutation.isPending}>
                      {createAccountMutation.isPending ? "Creating…" : "Create account"}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setIsAddingAccount(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </>
          )}

          {section === "data" && (
            <div className="surface-panel overflow-hidden p-0">
              <div className="panel-bar">
                <h2 className="panel-title">Data & export</h2>
              </div>
              <FormRow
                label="Full export (JSON)"
                hint={`Profile, portfolios, accounts, tags and up to the ${TRADES_LIST_DEFAULT_LIMIT} most recent trades in this portfolio. Uploaded attachments (screenshots) aren't included.`}
              >
                <Button type="button" variant="outline" size="sm" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
                  <Download /> {exportMutation.isPending ? "Preparing…" : "Download JSON"}
                </Button>
              </FormRow>
              <FormRow label="Filtered CSV export" hint="Export a filtered set of trades from the Journal.">
                <Link to="/app/journal" className="text-[13px] font-medium text-primary hover:underline">
                  Open the Journal
                </Link>
              </FormRow>
              <FormRow label="Delete account" hint="Account deletion is planned for a later phase — reach out directly if you need it.">
                <span className="text-[13px] text-muted-foreground">Not available yet</span>
              </FormRow>
            </div>
          )}
        </div>
      </div>

      {notice && (
        <div className="toast-message">
          <Check className="size-4 text-chart-2" />
          {notice}
        </div>
      )}
    </>
  );
}
