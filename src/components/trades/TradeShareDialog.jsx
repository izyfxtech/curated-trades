import React, { useState } from "react";
import { entities } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Globe, Lock, Trash2, Plus, Link2, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";

function generateSlug() {
  return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
}

export default function TradeShareDialog({ trade, open, onClose }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: sharedViews = [] } = useQuery({
    queryKey: ["sharedViews"],
    queryFn: () => entities.SharedView.list("-created_date"),
    enabled: open,
  });

  const tradeLinks = sharedViews.filter(v => v.type === "trade" && v.trade_id === trade?.id);

  const createMutation = useMutation({
    mutationFn: (data) => entities.SharedView.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sharedViews"] }),
  });

  const togglePublicMutation = useMutation({
    mutationFn: ({ id, is_public }) => entities.SharedView.update(id, { is_public }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sharedViews"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => entities.SharedView.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sharedViews"] }),
  });

  const handleCreate = () => {
    createMutation.mutate({
      slug: generateSlug(),
      type: "trade",
      title: `${trade?.symbol} ${trade?.direction} Trade`,
      trade_id: trade?.id,
      is_public: true,
      views: 0,
    });
  };

  const copyLink = (slug) => {
    const url = `${window.location.origin}/p/${slug}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Link copied!", description: url });
  };

  if (!trade) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-primary" />
            Share Trade — {trade.symbol}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Create a shareable link for this individual trade. Toggle between <strong className="text-foreground">Public</strong> (anyone with link can view) and <strong className="text-foreground">Private</strong> (link disabled).
          </p>

          {tradeLinks.length === 0 ? (
            <div className="text-center py-6 border border-dashed border-border rounded-xl">
              <Link2 className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground mb-3">No share links for this trade yet</p>
              <Button size="sm" onClick={handleCreate} disabled={createMutation.isPending}>
                <Plus className="w-4 h-4 mr-1.5" />Create Share Link
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {tradeLinks.map(link => (
                <div key={link.id} className="flex items-center justify-between gap-2 p-3 bg-secondary/20 rounded-lg border border-border">
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-muted-foreground truncate">{window.location.origin}/p/{link.slug}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Eye className="w-3 h-3 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground">{link.views || 0} views</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
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
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(link.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={handleCreate} disabled={createMutation.isPending} className="w-full">
                <Plus className="w-4 h-4 mr-1.5" />Create Another Link
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
