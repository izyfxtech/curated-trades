// Coach sharing ("/app/reports", Phase 2.5). This page only manages share
// links (create, list, revoke, read comments) — the actual polished report
// view is /share/$token, reused as-is for the owner's own preview/print and
// for whoever holds the link. Building one report view instead of two means
// "what the coach sees" and "what you see when you click Preview" can never
// drift apart.
//
// The create form is a TanStack Form; "Copy link" is a mutation that raises a
// toast (no `copied` flag + timeout); which share's comments are expanded is
// the `?comments=<shareId>` search param.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { ExternalLink, MessageSquare, Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import type { Database } from "@/integrations/supabase/types";
import { formProps, useAppForm } from "@/lib/form";
import { coachCommentsQueryOptions, coachSharesQueryOptions, workspaceQueryOptions } from "@/lib/queries";
import { createCoachShare, revokeCoachShare } from "@/lib/shares.functions";

type CoachShareRow = Database["public"]["Tables"]["coach_shares"]["Row"];

export const Route = createFileRoute("/app/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Curated Trades" },
      { name: "description", content: "Share a read-only report link with a coach or mentor, and manage access." },
    ],
  }),
  validateSearch: z.object({ comments: z.string().optional() }),
  component: ReportsPage,
});

const routeApi = getRouteApi("/app/reports");

const PERMISSION_OPTIONS = [
  { value: "read", label: "Read only" },
  { value: "comment", label: "Read + comment" },
] as const;

function shareUrl(token: string): string {
  if (typeof window === "undefined") return `/share/${token}`;
  return `${window.location.origin}/share/${token}`;
}

function shareState(share: CoachShareRow): { label: string; tone: "outline" | "secondary" | "destructive" } {
  if (share.revoked_at) return { label: "Revoked", tone: "destructive" };
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return { label: "Expired", tone: "secondary" };
  return { label: "Active", tone: "outline" };
}

function ShareRow({ share, portfolioId }: { share: CoachShareRow; portfolioId: string }) {
  const queryClient = useQueryClient();
  const navigate = routeApi.useNavigate();
  const showComments = routeApi.useSearch({ select: (search) => search.comments === share.id });
  const state = shareState(share);
  const url = shareUrl(share.token);

  const commentsQuery = useQuery(coachCommentsQueryOptions(share.id, showComments));

  const revokeMutation = useMutation({
    mutationFn: revokeCoachShare,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: coachSharesQueryOptions(portfolioId).queryKey }),
  });

  const copyLink = useMutation({
    mutationFn: () => navigator.clipboard.writeText(url),
    onSuccess: () => toast.success("Link copied"),
    onError: () => toast.error("Couldn't copy — select the link and copy it manually"),
  });

  return (
    <li className="surface-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <p className="font-medium">{share.label}</p>
            <Badge variant={state.tone}>{state.label}</Badge>
            <Badge variant="secondary">{share.permission === "comment" ? "Read + comment" : "Read only"}</Badge>
            {share.hide_dollar_pnl && <Badge variant="secondary">$ hidden</Badge>}
          </div>
          <p className="truncate text-xs text-muted-foreground">{url}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-mono">{share.view_count}</span> view{share.view_count === 1 ? "" : "s"}
            {share.last_viewed_at && (
              <>
                , last viewed <span className="font-mono">{new Date(share.last_viewed_at).toLocaleDateString()}</span>
              </>
            )}
            {share.expires_at && (
              <>
                , expires <span className="font-mono">{new Date(share.expires_at).toLocaleDateString()}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => copyLink.mutate()}>
            <Copy /> Copy link
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink /> Preview
            </a>
          </Button>
          {share.permission === "comment" && (
            <Button variant="outline" size="sm" onClick={() =>
                void navigate({ search: (prev) => ({ ...prev, comments: showComments ? undefined : share.id }), replace: true })
              }>
              <MessageSquare /> Comments
            </Button>
          )}
          {state.label === "Active" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => revokeMutation.mutate({ data: { shareId: share.id } })}
              disabled={revokeMutation.isPending}
            >
              <Trash2 /> Revoke
            </Button>
          )}
        </div>
      </div>
      {showComments && (
        <div className="mt-3 border-t border-border pt-3">
          {commentsQuery.isLoading && <p className="text-xs text-muted-foreground">Loading comments…</p>}
          {commentsQuery.data?.length === 0 && <p className="text-xs text-muted-foreground">No comments yet.</p>}
          <ul className="space-y-2">
            {commentsQuery.data?.map((comment) => (
              <li key={comment.id} className="text-sm">
                <span className="font-medium">{comment.author_name}</span>{" "}
                <span className="text-xs text-muted-foreground">{new Date(comment.created_at).toLocaleString()}</span>
                <p className="text-muted-foreground">{comment.body}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

const shareFormSchema = z.object({
  label: z.string(),
  permission: z.enum(["read", "comment"]),
  hideDollarPnl: z.boolean(),
  periodStart: z.string(),
  periodEnd: z.string(),
  expiresInDays: z.string().refine((value) => value.trim() === "" || Number(value) >= 1, "Enter 1 or more days, or leave blank"),
});

function ReportsPage() {
  const queryClient = useQueryClient();
  const { data: workspace } = useQuery(workspaceQueryOptions);
  const portfolioId = workspace?.activePortfolio.id;

  const { data: shares, isLoading } = useQuery(coachSharesQueryOptions(portfolioId));

  const createMutation = useMutation({
    mutationFn: createCoachShare,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: coachSharesQueryOptions(portfolioId).queryKey });
      form.reset();
      toast.success("Share link created");
    },
    onError: (error) => toast.error(error.message || "Couldn't create share link"),
  });

  const form = useAppForm({
    defaultValues: {
      label: "Shared report",
      permission: "read",
      hideDollarPnl: true,
      periodStart: "",
      periodEnd: "",
      expiresInDays: "30",
    } as z.infer<typeof shareFormSchema>,
    validators: { onSubmit: shareFormSchema },
    onSubmit: ({ value }) => {
      if (!portfolioId) return;
      createMutation.mutate({
        data: {
          portfolioId,
          label: value.label.trim() || "Shared report",
          permission: value.permission,
          hideDollarPnl: value.hideDollarPnl,
          periodStart: value.periodStart || null,
          periodEnd: value.periodEnd || null,
          expiresInDays: value.expiresInDays.trim() === "" ? null : Number(value.expiresInDays),
        },
      });
    },
  });

  if (!workspace) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <>
      <section className="mb-6 border-b border-border pb-5">
        <h1 className="page-title">Reports &amp; sharing</h1>
      </section>

      <form {...formProps(form)} className="surface-panel mb-6 p-6">
        <p className="panel-heading mb-4">Create a share link</p>
        <div className="metric-grid mb-4 items-start">
          <form.AppField name="label">{(field) => <field.TextField label="Label" />}</form.AppField>
          <form.AppField name="permission">
            {(field) => <field.SelectField label="Permission" options={PERMISSION_OPTIONS} />}
          </form.AppField>
          <div>
            <span className="field-label">Period (optional)</span>
            <form.Subscribe selector={(state) => ({ from: state.values.periodStart, to: state.values.periodEnd })}>
              {({ from, to }) => (
                <DateRangePicker
                  from={from}
                  to={to}
                  onChange={(range) => {
                    form.setFieldValue("periodStart", range.from);
                    form.setFieldValue("periodEnd", range.to);
                  }}
                  placeholder="Whole account history"
                />
              )}
            </form.Subscribe>
          </div>
          <form.AppField name="expiresInDays">
            {(field) => (
              <field.TextField label="Expires after (days, optional)" type="number" min="1" placeholder="Never" className="font-mono" />
            )}
          </form.AppField>
        </div>
        <div className="mb-4">
          <form.AppField name="hideDollarPnl">
            {(field) => <field.CheckboxField label="Hide dollar P&L (share win rate, R multiples, and profit factor only)" />}
          </form.AppField>
        </div>
        <form.AppForm>
          <form.SubmitButton pendingLabel="Creating…" pending={createMutation.isPending}>
            <Plus /> Create share link
          </form.SubmitButton>
        </form.AppForm>
      </form>

      <p className="panel-title mb-3">Share links</p>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {shares?.length === 0 && (
        <p className="surface-panel p-6 text-center text-sm text-muted-foreground">
          No share links yet. Create one above to send a read-only report to a coach or mentor.
        </p>
      )}
      <ul className="space-y-3">
        {shares?.map((share) => <ShareRow key={share.id} share={share} portfolioId={portfolioId as string} />)}
      </ul>
    </>
  );
}
