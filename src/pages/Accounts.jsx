import React, { useState } from "react";
import { entities } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Wallet, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/tradeUtils";
import { Badge } from "@/components/ui/badge";

export default function Accounts() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", platform: "", broker: "", starting_balance: "", currency: "USD", is_active: true });
  const queryClient = useQueryClient();

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => entities.Account.list("-created_date"),
  });

  const { data: trades = [] } = useQuery({
    queryKey: ["trades"],
    queryFn: () => entities.Trade.list("-close_time", 500),
  });

  const createMutation = useMutation({
    mutationFn: (data) => entities.Account.create({ ...data, starting_balance: parseFloat(data.starting_balance) || 0 }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["accounts"] }); setShowForm(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => entities.Account.update(id, { ...data, starting_balance: parseFloat(data.starting_balance) || 0 }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["accounts"] }); setShowForm(false); setEditing(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => entities.Account.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts"] }),
  });

  const handleSave = () => {
    if (editing) updateMutation.mutate({ id: editing.id, data: form });
    else createMutation.mutate(form);
  };

  const openEdit = (a) => {
    setEditing(a);
    setForm({ name: a.name, platform: a.platform || "", broker: a.broker || "", starting_balance: a.starting_balance || "", currency: a.currency || "USD", is_active: a.is_active !== false });
    setShowForm(true);
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Accounts</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your trading accounts</p>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setForm({ name: "", platform: "", broker: "", starting_balance: "", currency: "USD", is_active: true }); setShowForm(true); }}>
          <Plus className="w-4 h-4 mr-2" />Add Account
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {accounts.map(account => {
          const acctTrades = trades.filter(t => t.account === account.name);
          const pnl = acctTrades.reduce((s, t) => s + (t.net_pnl || t.pnl || 0), 0);
          const currentBalance = (account.starting_balance || 0) + pnl;

          return (
            <div key={account.id} className="bg-card rounded-xl border border-border p-5 hover:border-primary/30 transition-all group">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Wallet className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{account.name}</h3>
                    <p className="text-xs text-muted-foreground">{account.broker || account.platform || "—"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className={cn("text-[10px]", account.is_active !== false ? "border-emerald-400/30 text-emerald-400" : "border-muted-foreground/30 text-muted-foreground")}>
                    {account.is_active !== false ? "Active" : "Inactive"}
                  </Badge>
                  <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => openEdit(account)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive" onClick={() => deleteMutation.mutate(account.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border">
                <div>
                  <p className="text-[10px] text-muted-foreground">Balance</p>
                  <p className="text-sm font-mono font-semibold">${currentBalance.toFixed(0)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">P&L</p>
                  <p className={cn("text-sm font-mono font-semibold", pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {formatCurrency(pnl)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Trades</p>
                  <p className="text-sm font-mono font-semibold">{acctTrades.length}</p>
                </div>
              </div>
            </div>
          );
        })}

        {!accounts.length && (
          <div className="col-span-full bg-card rounded-xl border border-dashed border-border p-12 text-center">
            <Wallet className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No accounts yet</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => { setEditing(null); setForm({ name: "", platform: "", broker: "", starting_balance: "", currency: "USD", is_active: true }); setShowForm(true); }}>
              Add your first account
            </Button>
          </div>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Account" : "New Account"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Account Name</Label>
              <Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} className="bg-secondary/50 h-9 text-sm" placeholder="e.g. Main Live" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Platform</Label>
                <Input value={form.platform} onChange={(e) => setForm(p => ({ ...p, platform: e.target.value }))} className="bg-secondary/50 h-9 text-sm" placeholder="MetaTrader" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Broker</Label>
                <Input value={form.broker} onChange={(e) => setForm(p => ({ ...p, broker: e.target.value }))} className="bg-secondary/50 h-9 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Starting Balance</Label>
                <Input type="number" value={form.starting_balance} onChange={(e) => setForm(p => ({ ...p, starting_balance: e.target.value }))} className="bg-secondary/50 h-9 text-sm font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Currency</Label>
                <Input value={form.currency} onChange={(e) => setForm(p => ({ ...p, currency: e.target.value }))} className="bg-secondary/50 h-9 text-sm" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Active</Label>
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm(p => ({ ...p, is_active: v }))} />
            </div>
            <Button onClick={handleSave} className="w-full">{editing ? "Update" : "Create"} Account</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
