import React, { useMemo, useState } from "react";
import { entities } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { calcStats, formatCurrency } from "@/lib/tradeUtils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TrendingUp, Target, BarChart3, DollarSign, Link2, Copy, Globe, Lock, Plus, Trash2, Eye } from "lucide-react";
import EquityCurve from "@/components/dashboard/EquityCurve";
import WinLossDistribution from "@/components/analytics/WinLossDistribution";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";

function generateSlug() {
  return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
}

export default function SharePerformance() {
  const [timePeriod, setTimePeriod] = useState("all");
  const [showEquity, setShowEquity] = useState(true);
  const [showDistribution, setShowDistribution] = useState(true);
  const [simplified, setSimplified] = useState(false);
  const [creatingLink, setCreatingLink] = useState(false);
  const [newLinkTitle, setNewLinkTitle] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: trades = [] } = useQuery({
    queryKey: ["trades"],
    queryFn: () => entities.Trade.list("-close_time", 500),
  });

  const { data: sharedViews = [] } = useQuery({
    queryKey: ["sharedViews"],
    queryFn: () => entities.SharedView.list("-created_at"),
  });

  const filteredTrades = useMemo(() => {
    if (timePeriod === "all") return trades;
    const now = new Date();
    const cutoff = new Date();
    if (timePeriod === "7d") cutoff.setDate(now.getDate() - 7);
    if (timePeriod === "30d") cutoff.setDate(now.getDate() - 30);
    if (timePeriod === "90d") cutoff.setDate(now.getDate() - 90);
    if (timePeriod === "1y") cutoff.setFullYear(now.getFullYear() - 1);
    return trades.filter(t => new Date(t.close_time || t.created_at) >= cutoff);
  }, [trades, timePeriod]);

  const stats = useMemo(() => calcStats(filteredTrades), [filteredTrades]);

  const createLinkMutation = useMutation({
    mutationFn: (data) => entities.SharedView.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sharedViews"] });
      setCreatingLink(false);
      setNewLinkTitle("");
    },
    onError: (err) => toast({ title: "Failed to create share link", description: err?.message || "Something went wrong.", variant: "destructive" }),
  });

  const togglePublicMutation = useMutation({
    mutationFn: ({ id, is_public }) => entities.SharedView.update(id, { is_public }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sharedViews"] }),
    onError: (err) => toast({ title: "Failed to update link", description: err?.message || "Something went wrong.", variant: "destructive" }),
  });

  const deleteLinkMutation = useMutation({
    mutationFn: (id) => entities.SharedView.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sharedViews"] }),
    onError: (err) => toast({ title: "Failed to delete link", description: err?.message || "Something went wrong.", variant: "destructive" }),
  });

  const handleCreateLink = () => {
    createLinkMutation.mutate({
      slug: generateSlug(),
      type: "performance",
      title: newLinkTitle || "My Trading Performance",
      is_public: true,
      time_period: timePeriod,
      show_equity: showEquity,
      show_distribution: showDistribution,
      simplified,
      views: 0,
    });
  };

  const copyLink = (slug) => {
    const url = `${window.location.origin}/p/${slug}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Link copied!", description: url });
  };

  const performanceLinks = sharedViews.filter(v => v.type === "performance");

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground">Share Performance</h1>
        <p className="text-sm text-muted-foreground mt-1">Create shareable links to your trading results</p>
      </div>

      {/* How it works explanation */}
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-foreground mb-1.5">How sharing works</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          When you create a share link, it captures your current settings (time period, which charts to show). Anyone with the link can view a read-only snapshot of your stats if the link is set to <strong className="text-foreground">Public</strong>. Set it to <strong className="text-foreground">Private</strong> to disable access without deleting the link. Share individual trades from the Trades page using the share icon on each trade.
        </p>
      </div>

      {/* Preview Controls */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Configure Preview</h3>
        <div className="flex flex-wrap gap-4 md:gap-6 items-center">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Time Period</Label>
            <Select value={timePeriod} onValueChange={setTimePeriod}>
              <SelectTrigger className="w-[140px] h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="1y">Last year</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={showEquity} onCheckedChange={setShowEquity} id="equity" />
            <Label htmlFor="equity" className="text-xs text-muted-foreground">Equity Curve</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={showDistribution} onCheckedChange={setShowDistribution} id="dist" />
            <Label htmlFor="dist" className="text-xs text-muted-foreground">Win/Loss Chart</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={simplified} onCheckedChange={setSimplified} id="simple" />
            <Label htmlFor="simple" className="text-xs text-muted-foreground">Simplified</Label>
          </div>
        </div>
      </div>

      {/* Create Link */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Shared Performance Links</h3>
          <Button size="sm" onClick={() => setCreatingLink(true)} disabled={creatingLink}>
            <Plus className="w-4 h-4 mr-1.5" />Create Link
          </Button>
        </div>

        {creatingLink && (
          <div className="flex gap-2 mb-4 p-3 bg-secondary/30 rounded-lg">
            <Input
              placeholder="Link title (e.g. Q2 2025 Results)"
              value={newLinkTitle}
              onChange={e => setNewLinkTitle(e.target.value)}
              className="h-9 text-sm"
              onKeyDown={e => e.key === "Enter" && handleCreateLink()}
            />
            <Button size="sm" onClick={handleCreateLink} disabled={createLinkMutation.isPending}>Create</Button>
            <Button size="sm" variant="ghost" onClick={() => setCreatingLink(false)}>Cancel</Button>
          </div>
        )}

        {performanceLinks.length === 0 && !creatingLink && (
          <p className="text-xs text-muted-foreground text-center py-4">No share links yet. Create one above.</p>
        )}

        <div className="space-y-2">
          {performanceLinks.map(link => (
            <div key={link.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-secondary/20 rounded-lg border border-border">
              <div className="flex items-center gap-2 min-w-0">
                <Link2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{link.title || "Performance"}</p>
                  <p className="text-[10px] text-muted-foreground font-mono truncate">{window.location.origin}/p/{link.slug}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Eye className="w-3.5 h-3.5" />{link.views || 0}
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] cursor-pointer select-none",
                    link.is_public ? "border-emerald-400/40 text-emerald-500 hover:bg-emerald-400/10" : "border-muted-foreground/30 text-muted-foreground hover:bg-secondary"
                  )}
                  onClick={() => togglePublicMutation.mutate({ id: link.id, is_public: !link.is_public })}
                >
                  {link.is_public ? <Globe className="w-2.5 h-2.5 mr-1" /> : <Lock className="w-2.5 h-2.5 mr-1" />}
                  {link.is_public ? "Public" : "Private"}
                </Badge>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copyLink(link.slug)}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteLinkMutation.mutate(link.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Preview Card */}
      <div className="bg-card rounded-2xl border border-border p-5 md:p-8 space-y-6" id="share-card">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center flex-shrink-0">
            <TrendingUp className="w-5 h-5 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h2 className="font-heading font-bold text-foreground">Trading Performance</h2>
            <p className="text-xs text-muted-foreground">
              {timePeriod === "all" ? "All Time" : `Last ${timePeriod.replace("d", " days").replace("1y", "Year")}`} · {filteredTrades.length} trades
            </p>
          </div>
        </div>

        <div className={cn("grid gap-3", simplified ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4")}>
          {[
            { icon: DollarSign, label: "Net Profit", value: formatCurrency(stats.totalPnl), colored: true, positive: stats.totalPnl >= 0 },
            { icon: Target, label: "Win Rate", value: `${stats.winRate.toFixed(1)}%` },
            ...(!simplified ? [
              { icon: BarChart3, label: "Profit Factor", value: stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2) },
              { icon: TrendingUp, label: "Avg R:R", value: `${stats.avgRR?.toFixed(2) || "—"}R` },
            ] : []),
          ].map((s, i) => (
            <div key={i} className="bg-secondary/30 rounded-xl p-3 md:p-4 overflow-hidden">
              <s.icon className="w-4 h-4 text-muted-foreground mb-2" />
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={cn("text-lg md:text-xl font-mono font-bold truncate", s.colored ? (s.positive ? "text-emerald-400" : "text-red-400") : "text-foreground")}>
                {s.value}
              </p>
            </div>
          ))}
        </div>

        {showEquity && <EquityCurve trades={filteredTrades} />}
        {showDistribution && <WinLossDistribution trades={filteredTrades} />}
      </div>
    </div>
  );
}
