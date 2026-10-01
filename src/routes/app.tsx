// Layout shell for every authenticated page (/app, /app/journal, etc.):
// left sidebar (slide-over drawer on small screens), the app bar with the
// portfolio/account context, theme toggle, sign-out, and — importantly — the
// only two gates that decide whether a visitor sees the dashboard at all,
// both expressed as Router guards rather than component effects:
//   1. `beforeLoad`: redirects to /sign-in if there's no session.
//   2. `loader`: preloads the workspace and redirects to /onboarding if the
//      profile hasn't completed setup yet.
// If the workspace fails to load, the route's `errorComponent` shows the real
// error with a retry button rather than hanging on a loading spinner forever
// — that silent-hang behavior was a real bug in the effect-based version.
//
// NOTE on SSR: Supabase's session lives in browser localStorage, which
// doesn't exist during server rendering, so this whole subtree is
// `ssr: false` — the guards genuinely can't run on the server. The real data
// boundary is `requireSupabaseAuth` on every server function in
// src/lib/*.functions.ts; these redirects are UX only.
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import {
  BarChart3,
  BookOpen,
  Calculator,
  ChevronsUpDown,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Settings2,
  ShieldCheck,
  Sun,
  Target,
} from "lucide-react";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";

import { RouteError } from "@/components/RouteError";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { setActiveAccount } from "@/lib/accounts.functions";
import { formatMoney, workspaceCurrency } from "@/lib/money";
import { setActivePortfolio } from "@/lib/portfolios.functions";
import { sessionQueryOptions, workspaceQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/app")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (!session) throw redirect({ to: "/sign-in", search: { redirect: location.href } });
  },
  // Also primes the "workspace" cache the moment the router starts loading
  // this route — which, combined with defaultPreload: "intent" in router.tsx,
  // means as soon as someone hovers or focuses a link into the app (the
  // sidebar, "Log trade", the landing page's CTA), this fetch is already in
  // flight before they click. Every page below then finds the workspace
  // already in cache instead of starting a fresh request.
  loader: async ({ context }) => {
    const workspace = await context.queryClient.ensureQueryData(workspaceQueryOptions);
    if (!workspace.profile.onboarding_completed) throw redirect({ to: "/onboarding" });
  },
  pendingComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      Loading your journal…
    </div>
  ),
  errorComponent: RouteError,
  component: AuthenticatedLayout,
});

// Sidebar navigation, grouped by where each page sits in the daily loop:
// look at the numbers, do the work, then set up the guard-rails.
const NAV_GROUPS = [
  {
    label: "Workspace",
    items: [
      { to: "/app", label: "Overview", icon: LayoutDashboard, exact: true },
      { to: "/app/journal", label: "Journal", icon: BookOpen, exact: false },
      { to: "/app/analytics", label: "Analytics", icon: BarChart3, exact: false },
    ],
  },
  {
    label: "Practice",
    items: [
      { to: "/app/playbooks", label: "Playbooks", icon: Target, exact: false },
      { to: "/app/reviews", label: "Reviews", icon: ClipboardList, exact: false },
      { to: "/app/reports", label: "Reports", icon: FileText, exact: false },
    ],
  },
  {
    label: "Tools",
    items: [
      { to: "/app/prop-rules", label: "Prop rules", icon: ShieldCheck, exact: false },
      { to: "/app/risk-calculator", label: "Risk calculator", icon: Calculator, exact: false },
    ],
  },
] as const;

// Radix Select requires non-empty string values, so "All accounts" (which
// is really "no account selected" — activeAccount === null) needs a
// stand-in sentinel that gets translated back to null before calling
// setActiveAccount.
const ALL_ACCOUNTS_VALUE = "__all__";

type Workspace = ReturnType<typeof useWorkspace>;
function useWorkspace() {
  return useSuspenseQuery(workspaceQueryOptions).data;
}

/** In the mobile drawer, tapping a nav item should close it; on the desktop
 * sidebar there's nothing to close. Radix's Close primitive does this without
 * any open/closed state of our own. */
function CloseInDrawer({ inDrawer, children }: { inDrawer: boolean; children: ReactNode }) {
  return inDrawer ? <DialogPrimitive.Close asChild>{children}</DialogPrimitive.Close> : <>{children}</>;
}

// Rendered twice — as the fixed sidebar on desktop and inside the drawer on
// small screens — so both always list the same pages.
function SidebarContent({ workspace, inDrawer }: { workspace: Workspace; inDrawer: boolean }) {
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const profileName = workspace.profile.display_name || "Trader";

  // The auth listener in router.tsx turns SIGNED_OUT into a cache clear and a
  // guard re-run, which redirects to /sign-in — nothing else to do here.
  const signOut = useMutation({ mutationFn: () => supabase.auth.signOut() });

  return (
    <>
      <CloseInDrawer inDrawer={inDrawer}>
        <Link to="/app" className="brand" aria-label="Curated Trades overview">
          <span className="brand-mark" aria-hidden="true" />
          <span className="wordmark">
            Curated <em>Trades</em>
          </span>
        </Link>
      </CloseInDrawer>

      <nav className="flex flex-col gap-5" aria-label="Main navigation">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="nav-group-label">{group.label}</p>
            <div className="nav-list">
              {group.items.map((item) => (
                <CloseInDrawer key={item.to} inDrawer={inDrawer}>
                  <Link to={item.to} activeOptions={{ exact: item.exact }}>
                    {({ isActive }: { isActive: boolean }) => (
                      <span className={`nav-link ${isActive ? "nav-link-active" : ""}`}>
                        <item.icon />
                        {item.label}
                      </span>
                    )}
                  </Link>
                </CloseInDrawer>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="nav-link" onClick={() => setTheme(isDark ? "light" : "dark")}>
          {isDark ? <Sun /> : <Moon />}
          {isDark ? "Light mode" : "Dark mode"}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-sidebar-accent"
              aria-label="Account menu"
            >
              <span className="avatar">{profileName.slice(0, 2).toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-sidebar-accent-foreground">{profileName}</span>
                <span className="block truncate text-xs text-muted-foreground">{workspace.activePortfolio.name}</span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="min-w-[13rem]">
            <DropdownMenuItem onSelect={() => void navigate({ to: "/app/settings" })}>
              <Settings2 className="size-4 text-muted-foreground" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => signOut.mutate()}>
              <LogOut className="size-4 text-muted-foreground" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}

function AuthenticatedLayout() {
  const queryClient = useQueryClient();
  // The route loader already put this in cache, so it never suspends here.
  const workspace = useWorkspace();

  const switchPortfolioMutation = useMutation({
    mutationFn: (portfolioId: string) => setActivePortfolio({ data: { portfolioId } }),
    onSuccess: () => queryClient.invalidateQueries(workspaceQueryOptions),
  });

  const switchAccountMutation = useMutation({
    mutationFn: (accountId: string | null) =>
      setActiveAccount({ data: { portfolioId: workspace.activePortfolio.id, accountId } }),
    onSuccess: () => queryClient.invalidateQueries(workspaceQueryOptions),
  });

  const scopeLabel = workspace.activeAccount?.name ?? "All accounts";

  return (
    <DialogPrimitive.Root>
      <div className="app-shell bg-background text-foreground">
        <aside className="sidebar" aria-label="Sidebar">
          <SidebarContent workspace={workspace} inDrawer={false} />
        </aside>

        {/* Mobile slide-over. Radix Dialog gives focus trapping, Escape and
            outside-click closing, and scroll lock — with no open/closed state
            of our own (the trigger below opens it; CloseInDrawer closes it). */}
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="drawer-backdrop lg:hidden">
            <DialogPrimitive.Content className="drawer" aria-describedby={undefined}>
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              <SidebarContent workspace={workspace} inDrawer />
            </DialogPrimitive.Content>
          </DialogPrimitive.Overlay>
        </DialogPrimitive.Portal>

        <div className="min-w-0 flex-1">
          <header className="appbar">
            <div className="appbar-inner">
              <DialogPrimitive.Trigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                  <Menu />
                </Button>
              </DialogPrimitive.Trigger>

              <div className="contextbar-group">
                <span className="contextbar-label">Portfolio</span>
                {workspace.portfolios.length > 1 ? (
                  <Select value={workspace.activePortfolio.id} onValueChange={(value) => switchPortfolioMutation.mutate(value)}>
                    <SelectTrigger className="h-8 w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {workspace.portfolios.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-[13px] font-medium">{workspace.activePortfolio.name}</span>
                )}
              </div>
              <div className="contextbar-group">
                <span className="contextbar-label">Account</span>
                <Select
                  value={workspace.activeAccount?.id ?? ALL_ACCOUNTS_VALUE}
                  onValueChange={(value) => switchAccountMutation.mutate(value === ALL_ACCOUNTS_VALUE ? null : value)}
                >
                  <SelectTrigger className="h-8 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_ACCOUNTS_VALUE}>All accounts</SelectItem>
                    {workspace.accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="ml-auto flex items-center gap-3">
                <span className="equity-chip hidden sm:inline-flex">
                  {scopeLabel} equity
                  <strong>{formatMoney(workspace.liveEquity, workspaceCurrency(workspace))}</strong>
                </span>
                <Link to="/app/journal" search={{ new: true }}>
                  <Button size="sm">
                    <Plus /> Log trade
                  </Button>
                </Link>
              </div>
            </div>
          </header>

          <main className="content-wrap">
            <Outlet />
          </main>
        </div>
      </div>
    </DialogPrimitive.Root>
  );
}
