import React, { useState } from "react";
import { entities } from '@/api/entities';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Upload, LayoutGrid, List, Image, TableIcon } from "lucide-react";
import TradeTable from "@/components/trades/TradeTable";
import TradeGridView from "@/components/trades/TradeGridView";
import TradeListView from "@/components/trades/TradeListView";
import TradeScreenshotView from "@/components/trades/TradeScreenshotView";
import TradeForm from "@/components/trades/TradeForm";
import ImportTradesDialog from "@/components/trades/ImportTradesDialog";
import TradeShareDialog from "@/components/trades/TradeShareDialog";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";

const viewOptions = [
  { key: "table", icon: TableIcon, label: "Table" },
  { key: "list", icon: List, label: "List" },
  { key: "grid", icon: LayoutGrid, label: "Grid" },
  { key: "screenshot", icon: Image, label: "Screenshots" },
];

export default function Trades() {
  const [showForm, setShowForm] = useState(false);
  const [editingTrade, setEditingTrade] = useState(null);
  const [deletingTrade, setDeletingTrade] = useState(null);
  const [sharingTrade, setSharingTrade] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [search, setSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [viewMode, setViewMode] = useState("table");
  const queryClient = useQueryClient();

  const { data: trades = [], isLoading } = useQuery({
    queryKey: ["trades"],
    queryFn: () => entities.Trade.list("-close_time", 500),
  });

  const createMutation = useMutation({
    mutationFn: (data) => entities.Trade.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["trades"] }); setShowForm(false); setEditingTrade(null); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => entities.Trade.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["trades"] }); setShowForm(false); setEditingTrade(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => entities.Trade.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["trades"] }); setDeletingTrade(null); },
  });

  const handleSave = (data) => {
    if (editingTrade) {
      updateMutation.mutate({ id: editingTrade.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const filtered = trades.filter(t => {
    const matchSearch = !search || t.symbol?.toLowerCase().includes(search.toLowerCase()) || t.strategy?.toLowerCase().includes(search.toLowerCase());
    const matchOutcome = outcomeFilter === "all" || t.outcome === outcomeFilter || (outcomeFilter === "open" && (!t.close_time && !t.exit_price));
    return matchSearch && matchOutcome;
  });

  const viewProps = { trades: filtered, onEdit: (t) => { setEditingTrade(t); setShowForm(true); }, onDelete: (t) => setDeletingTrade(t), onShare: (t) => setSharingTrade(t) };

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Trades</h1>
          <p className="text-sm text-muted-foreground mt-1">{trades.length} total trades</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
            <Upload className="w-4 h-4 mr-2" />Import
          </Button>
          <Button size="sm" onClick={() => { setEditingTrade(null); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-2" />Log Trade
          </Button>
        </div>
      </div>

      {/* Filters + View switcher */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search symbol, strategy..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-card border-border h-9 text-sm"
          />
        </div>
        <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
          <SelectTrigger className="w-[140px] bg-card border-border h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Outcomes</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="win">Wins</SelectItem>
            <SelectItem value="loss">Losses</SelectItem>
            <SelectItem value="breakeven">Breakeven</SelectItem>
          </SelectContent>
        </Select>

        {/* View mode switcher */}
        <div className="flex items-center bg-card border border-border rounded-lg p-1 gap-0.5 ml-auto sm:ml-0">
          {viewOptions.map(v => (
            <button
              key={v.key}
              onClick={() => setViewMode(v.key)}
              title={v.label}
              className={cn(
                "p-1.5 rounded-md transition-all",
                viewMode === v.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
            >
              <v.icon className="w-4 h-4" />
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-4 border-muted border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {viewMode === "table" && <TradeTable {...viewProps} />}
          {viewMode === "list" && <TradeListView {...viewProps} />}
          {viewMode === "grid" && <TradeGridView {...viewProps} />}
          {viewMode === "screenshot" && <TradeScreenshotView {...viewProps} />}
        </>
      )}

      <TradeForm
        trade={editingTrade}
        open={showForm}
        onClose={() => { setShowForm(false); setEditingTrade(null); }}
        onSave={handleSave}
      />
 <ImportTradesDialog open={showImport} onClose={() => setShowImport(false)} />
      <TradeShareDialog trade={sharingTrade} open={!!sharingTrade} onClose={() => setSharingTrade(null)} />

      <AlertDialog open={!!deletingTrade} onOpenChange={() => setDeletingTrade(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Trade</AlertDialogTitle>
            <AlertDialogDescription>Are you sure? This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteMutation.mutate(deletingTrade?.id)} className="bg-destructive hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
