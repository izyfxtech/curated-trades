import React, { useState } from "react";
import { entities } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTradeFilter } from "@/lib/TradeFilterContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Target, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { calcStats, formatCurrency } from "@/lib/tradeUtils";
import { useToast } from "@/components/ui/use-toast";

export default function Strategies() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", description: "", rules: "", timeframe: "", status: "active" });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { filteredTrades: trades } = useTradeFilter();

  const { data: strategies = [] } = useQuery({
    queryKey: ["strategies"],
    queryFn: () => entities.Strategy.list("-created_at"),
  });

  const createMutation = useMutation({
    mutationFn: (data) => entities.Strategy.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["strategies"] }); setShowForm(false); },
    onError: (err) => {
      const isDuplicate = err?.message?.includes("unique") || err?.code === "23505";
      toast({
        title: "Failed to create strategy",
        description: isDuplicate ? "A strategy with that name already exists." : (err?.message || "Something went wrong."),
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => entities.Strategy.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["strategies"] }); setShowForm(false); setEditing(null); },
    onError: (err) => {
      const isDuplicate = err?.message?.includes("unique") || err?.code === "23505";
      toast({
        title: "Failed to update strategy",
        description: isDuplicate ? "A strategy with that name already exists." : (err?.message || "Something went wrong."),
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => entities.Strategy.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["strategies"] }),
    onError: (err) => toast({ title: "Failed to delete strategy", description: err?.message || "Something went wrong.", variant: "destructive" }),
  });

  const handleSave = () => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const openEdit = (s) => {
    setEditing(s);
    setForm({ name: s.name, description: s.description || "", rules: s.rules || "", timeframe: s.timeframe || "", status: s.status || "active" });
    setShowForm(true);
  };

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", description: "", rules: "", timeframe: "", status: "active" });
    setShowForm(true);
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Strategy Library</h1>
          <p className="text-sm text-muted-foreground mt-1">Track and evaluate your strategies</p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="w-4 h-4 mr-2" />Add Strategy
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {strategies.map(strategy => {
          const stratTrades = trades.filter(t => t.strategy === strategy.name);
          const stats = calcStats(stratTrades);

          return (
            <div key={strategy.id} className="bg-card rounded-xl border border-border p-5 hover:border-primary/30 transition-all group">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Target className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{strategy.name}</h3>
                    <Badge variant="outline" className={cn(
                      "text-[10px] mt-0.5",
                      strategy.status === "active" ? "border-emerald-400/30 text-emerald-400" : strategy.status === "testing" ? "border-yellow-400/30 text-yellow-400" : "border-muted-foreground/30 text-muted-foreground"
                    )}>
                      {strategy.status}
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(strategy)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(strategy.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              {strategy.description && (
                <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{strategy.description}</p>
              )}
              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border">
                <div>
                  <p className="text-[10px] text-muted-foreground">Trades</p>
                  <p className="text-sm font-mono font-semibold">{stats.totalTrades}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Win Rate</p>
                  <p className="text-sm font-mono font-semibold">{stats.winRate.toFixed(0)}%</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">P&L</p>
                  <p className={cn("text-sm font-mono font-semibold", stats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {formatCurrency(stats.totalPnl)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}

        {!strategies.length && (
          <div className="col-span-full bg-card rounded-xl border border-dashed border-border p-12 text-center">
            <Target className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No strategies yet</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={openNew}>Create your first strategy</Button>
          </div>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Strategy" : "New Strategy"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} className="bg-secondary/50 h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} className="bg-secondary/50 text-sm min-h-[80px]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Rules / Entry Criteria</Label>
              <Textarea value={form.rules} onChange={(e) => setForm(p => ({ ...p, rules: e.target.value }))} className="bg-secondary/50 text-sm min-h-[80px]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Timeframe</Label>
                <Input value={form.timeframe} onChange={(e) => setForm(p => ({ ...p, timeframe: e.target.value }))} className="bg-secondary/50 h-9 text-sm" placeholder="e.g. 15m, 1H" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger className="bg-secondary/50 h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="testing">Testing</SelectItem>
                    <SelectItem value="retired">Retired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={handleSave} className="w-full">{editing ? "Update" : "Create"} Strategy</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
