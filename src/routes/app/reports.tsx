// Coach sharing ("/app/reports", Phase 2.5). This page only manages share
// links (create, list, revoke, read comments) — the actual polished report
// view is /share/$token, reused as-is for the owner's own preview/print and
// for whoever holds the link. Building one report view instead of two means
// "what the coach sees" and "what you see when you click Preview" can never
// drift apart.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Check, Copy, ExternalLink, MessageSquare, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getWorkspace } from "@/lib/portfolios.functions";
import { createCoachShare, listCoachCommentsForOwner, listCoachShares, revokeCoachShare } from "@/lib/shares.functions";
import type { Database } from "@/integrations/supabase/types";

type CoachShareRow = Database["public"]["Tables"]["coach_shares"]["Row"];

export const Route = createFileRoute("/app/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Curated Trades" },
      { name: "description", content: "Share a read-only report link with a coach or mentor, and manage access." },
    ],
  }),
  component: ReportsPage,
});

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
  const [copied, setCopied] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const state = shareState(share);
  const url = shareUrl(share.token);

  const commentsQuery = useQuery({
    queryKey: ["coach-comments", share.id],
    queryFn: () => listCoachCommentsForOwner({ data: { shareId: share.id } }),
    enabled: showComments,
  });

  const revokeMutation = useMutation({
    mutationFn: revokeCoachShare,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["coach-shares", portfolioId] }),
  });

  function copyLink() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

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
          <Button variant="outline" size="sm" onClick={copyLink}>
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink /> Preview
            </a>
          </Button>
          {share.permission === "comment" && (
            <Button variant="outline" size="sm" onClick={() => setShowComments((v) => !v)}>
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

function ReportsPage() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("Shared report");
  const [permission, setPermission] = useState<"read" | "comment">("read");
  const [hideDollarPnl, setHideDollarPnl] = useState(true);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("30");

  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => getWorkspace() });
  const workspace = workspaceQuery.data;
  const portfolioId = workspace?.activePortfolio.id;

  const sharesQuery = useQuery({
    queryKey: ["coach-shares", portfolioId],
    queryFn: () => listCoachShares({ data: { portfolioId: portfolioId as string } }),
    enabled: portfolioId != null,
  });

  const createMutation = useMutation({
    mutationFn: createCoachShare,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coach-shares", portfolioId] });
      setLabel("Shared report");
      setPeriodStart("");
      setPeriodEnd("");
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createMutation.isPending) return;
    if (!portfolioId) return;
    createMutation.mutate({
      data: {
        portfolioId,
        label: label.trim() || "Shared report",
        permission,
        hideDollarPnl,
        periodStart: periodStart || null,
        periodEnd: periodEnd || null,
        expiresInDays: expiresInDays.trim() === "" ? null : Number(expiresInDays),
      },
    });
  }

  if (workspaceQuery.isLoading || !workspace) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <>
      <section className="mb-6 border-b border-border pb-5">
        <h1 className="page-title">Reports &amp; sharing</h1>
      </section>

      <form onSubmit={handleSubmit} className="surface-panel mb-6 p-6">
        <p className="panel-heading mb-4">Create a share link</p>
        <div className="metric-grid mb-4">
          <div>
            <label className="field-label" htmlFor="share-label">
              Label
            </label>
            <Input id="share-label" value={label} onChange={(event) => setLabel(event.target.value)} />
          </div>
          <div>
            <label className="field-label">Permission</label>
            <Select value={permission} onValueChange={(value) => setPermission(value as "read" | "comment")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">Read only</SelectItem>
                <SelectItem value="comment">Read + comment</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <span className="field-label">Period (optional)</span>
            <DateRangePicker
              from={periodStart}
              to={periodEnd}
              onChange={({ from, to }) => { setPeriodStart(from); setPeriodEnd(to); }}
              placeholder="Whole account history"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="share-expires">
              Expires after (days, optional)
            </label>
            <Input
              id="share-expires"
              type="number"
              min="1"
              placeholder="Never"
              className="font-mono"
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(event.target.value)}
            />
          </div>
        </div>
        <label className="mb-4 flex items-center gap-2 text-sm">
          <Checkbox checked={hideDollarPnl} onCheckedChange={(checked) => setHideDollarPnl(checked === true)} />
          Hide dollar P&amp;L (share win rate, R multiples, and profit factor only)
        </label>
        <Button type="submit" disabled={createMutation.isPending}>
          <Plus /> {createMutation.isPending ? "Creating…" : "Create share link"}
        </Button>
      </form>

      <p className="panel-title mb-3">Share links</p>
      {sharesQuery.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {sharesQuery.data?.length === 0 && (
        <p className="surface-panel p-6 text-center text-sm text-muted-foreground">
          No share links yet. Create one above to send a read-only report to a coach or mentor.
        </p>
      )}
      <ul className="space-y-3">
        {sharesQuery.data?.map((share) => <ShareRow key={share.id} share={share} portfolioId={portfolioId as string} />)}
      </ul>
    </>
  );
}
