import React, { useState } from "react";
import { entities } from '@/api/entities';
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTradeFilter } from "@/lib/TradeFilterContext";
import { Button } from "@/components/ui/button";
import { Plus, Upload, LayoutGrid, List, Image, TableIcon } from "lucide-react";
import TradeTable from "@/components/trades/TradeTable";
import TradeGridView from "@/components/trades/TradeGridView";
import TradeListView from "@/components/trades/TradeListView";
import TradeScreenshotView from "@/components/trades/TradeScreenshotView";
import TradeForm from "@/components/trades/TradeForm";
import ImportTradesDialog from "@/components/trades/ImportTradesDialog";
import TradeShareDialog from "@/components/trades/TradeShareDialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
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
  const [viewMode, setViewMode] = useState("table");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // All filtering now comes from the global context
  const { filteredTrades, allTrades, tradesLoading: isLoading } = useTradeFilter();

  const createMutation = useMutation({
    mutationFn: (data) => entities.Trade.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["trades"] }); setShowForm(false); setEditingTrade(null); },
    onError: (err) => toast({ title: "Failed to save trade", description: err?.message || "Something went wrong.", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => entities.Trade.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["trades"] }); setShowForm(false); setEditingTrade(null); },
    onError: (err) => toast({ title: "Failed to update trade", description: err?.message || "Something went wrong.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => entities.Trade.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["trades"] }); setDeletingTrade(null); },
    onError: (err) => toast({ title: "Failed to delete trade", description: err?.message || "Something went wrong.", variant: "destructive" }),
  });

  const handleSave = (data) => {
    if (editingTrade) {
      updateMutation.mutate({ id: editingTrade.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const viewProps = {
    trades: filteredTrades,
    onEdit: (t) => { setEditingTrade(t); setShowForm(true); },
    onDelete: (t) => setDeletingTrade(t),
    onShare: (t) => setSharingTrade(t),
  };

  const isFiltered = filteredTrades.length !== allTrades.length;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Trades</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isFiltered
              ? <>{filteredTrades.length} <span className="text-primary font-medium">filtered</span> of {allTrades.length} trades</>
              : <>{allTrades.length} total trades</>
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode switcher */}
          <div className="flex items-center bg-card border border-border rounded-lg p-1 gap-0.5">
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
          <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
            <Upload className="w-4 h-4 mr-2" />Import
          </Button>
          <Button size="sm" onClick={() => { setEditingTrade(null); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-2" />Log Trade
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-4 border-muted border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {viewMode === "table"      && <TradeTable {...viewProps} />}
          {viewMode === "list"       && <TradeListView {...viewProps} />}
          {viewMode === "grid"       && <TradeGridView {...viewProps} />}
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
