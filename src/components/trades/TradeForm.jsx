import React, { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { X, Save, Upload, Calculator } from "lucide-react";
import { entities } from '@/api/entities';
import { supabase } from '@/api/supabaseClient';

import DateTimePicker from "./DateTimePicker";
import { calculatePnl, getQuantityLabel } from "@/lib/pnlEngine";

const emotions = ["confident", "calm", "anxious", "fearful", "greedy", "frustrated", "neutral"];
const sessions = ["asian", "london", "new_york", "overlap"];

const BLANK_FORM = {
  symbol: "", direction: "long", entry_price: "", exit_price: "",
  stop_loss: "", take_profit: "", lot_size: "", pnl: "",
  commission: "", swap: "", risk_reward: "",
  open_time: "", close_time: "", session: "", strategy: "",
  tags: [], emotion: "", rating: 3, execution_quality: 5,
  setup_quality: 5, discipline_score: 5, notes: "",
  screenshots: [], account: "", platform: "", pnl_manual_override: false,
};

export default function TradeForm({ trade, open, onClose, onSave }) {
  const [form, setForm] = useState(BLANK_FORM);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => entities.Account.list(),
  });
  const { data: strategies = [] } = useQuery({
    queryKey: ["strategies"],
    queryFn: () => entities.Strategy.list(),
  });
  const [uploading, setUploading] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showLeaveWarning, setShowLeaveWarning] = useState(false);
  const [pendingClose, setPendingClose] = useState(false);
  const initialFormRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const base = trade ? {
      ...BLANK_FORM,
      ...trade,
      entry_price: trade.entry_price ?? "",
      exit_price: trade.exit_price ?? "",
      stop_loss: trade.stop_loss ?? "",
      take_profit: trade.take_profit ?? "",
      lot_size: trade.lot_size ?? "",
      pnl: trade.pnl ?? "",
      commission: trade.commission ?? "",
      swap: trade.swap ?? "",
      risk_reward: trade.risk_reward ?? "",
      tags: trade.tags || [],
      mistakes: trade.mistakes || [],
      screenshots: trade.screenshots || [],
      open_time: trade.open_time ? new Date(trade.open_time).toISOString().slice(0, 16) : "",
      close_time: trade.close_time ? new Date(trade.close_time).toISOString().slice(0, 16) : "",
      pnl_manual_override: false,
    } : { ...BLANK_FORM };
    setForm(base);
    initialFormRef.current = JSON.stringify(base);
    setIsDirty(false);
  }, [trade, open]);

  const handleChange = (field, value) => {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      setIsDirty(JSON.stringify(next) !== initialFormRef.current);
      return next;
    });
  };

  // Auto-calculate PnL when prices change, unless manual override
  const calcedPnl = React.useMemo(() => {
    if (!form.symbol || !form.entry_price || !form.exit_price || !form.lot_size) return null;
    const result = calculatePnl({
      symbol: form.symbol,
      direction: form.direction,
      entryPrice: parseFloat(form.entry_price),
      exitPrice: parseFloat(form.exit_price),
      quantity: parseFloat(form.lot_size),
      commission: parseFloat(form.commission) || 0,
      swap: parseFloat(form.swap) || 0,
    });
    return result;
  }, [form.symbol, form.direction, form.entry_price, form.exit_price, form.lot_size, form.commission, form.swap]);

  const handleScreenshot = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id ?? 'anonymous';
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', 'curated-trades-uploads');
      // folder param scopes uploads to a per-user directory in Cloudinary
      formData.append('folder', `curated-trades/${userId}`);
      const res = await fetch('https://api.cloudinary.com/v1_1/df5e29hmo/image/upload', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const json = await res.json();
      setForm(prev => ({ ...prev, screenshots: [...prev.screenshots, json.secure_url] }));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = () => {
    const data = { ...form };
    const numFields = ["entry_price", "exit_price", "stop_loss", "take_profit", "lot_size", "pnl", "commission", "swap", "risk_reward"];
    numFields.forEach(f => {
      if (data[f] !== "" && data[f] !== undefined && data[f] !== null) data[f] = parseFloat(data[f]);
      else delete data[f];
    });

    // Use calculated PnL unless manually overridden
    if (!data.pnl_manual_override && calcedPnl) {
      data.pnl = Math.round(calcedPnl.grossPnl * 100) / 100;
      data.net_pnl = Math.round(calcedPnl.netPnl * 100) / 100;
    } else if (data.pnl !== undefined) {
      data.net_pnl = (data.pnl || 0) - (data.commission || 0) - (data.swap || 0);
    }

    // Status: open if no exit price/close time
    const resolvedPnl = data.net_pnl ?? data.pnl;
    if (!data.exit_price && !data.close_time) {
      data.outcome = "open";
    } else if (resolvedPnl == null) {
      data.outcome = "open";
    } else if (resolvedPnl > 0) {
      data.outcome = "win";
    } else if (resolvedPnl < 0) {
      data.outcome = "loss";
    } else {
      data.outcome = "breakeven";
    }

    if (data.open_time && data.close_time) {
      data.duration_minutes = (new Date(data.close_time) - new Date(data.open_time)) / 60000;
    }
    delete data.pnl_manual_override;
    onSave(data);
    setIsDirty(false);
  };

  const requestClose = () => {
    if (isDirty) {
      setShowLeaveWarning(true);
    } else {
      onClose();
    }
  };

  const handleDiscard = () => {
    setShowLeaveWarning(false);
    setIsDirty(false);
    onClose();
  };

  const handleSaveDraft = () => {
    setShowLeaveWarning(false);
    handleSubmit();
  };

  const quantityLabel = getQuantityLabel(form.symbol);

  // Positive-only number field (entry prices, lot sizes, etc.)
  const posNumField = (label, field, opts = {}) => (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step="any"
        min={opts.allowNegative ? undefined : "0"}
        value={form[field]}
        onChange={(e) => {
          let val = e.target.value;
          if (!opts.allowNegative && parseFloat(val) < 0) val = "0";
          handleChange(field, val);
        }}
        className="bg-secondary/50 border-border h-9 font-mono text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </div>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">{trade ? "Edit Trade" : "Log Trade"}</DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="details" className="mt-2">
            <TabsList className="bg-secondary/50 w-full">
              <TabsTrigger value="details" className="flex-1 text-xs">Details</TabsTrigger>
              <TabsTrigger value="journal" className="flex-1 text-xs">Journal</TabsTrigger>
              <TabsTrigger value="psychology" className="flex-1 text-xs">Psychology</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Symbol</Label>
                  <Input
                    value={form.symbol}
                    onChange={(e) => handleChange("symbol", e.target.value.toUpperCase())}
                    className="bg-secondary/50 border-border h-9 text-sm font-mono"
                    placeholder="EURUSD, AAPL, BTC..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Direction</Label>
                  <Select value={form.direction} onValueChange={(v) => handleChange("direction", v)}>
                    <SelectTrigger className="bg-secondary/50 border-border h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="long">Long / Buy</SelectItem>
                      <SelectItem value="short">Short / Sell</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {posNumField("Entry Price", "entry_price")}
                {posNumField("Exit Price", "exit_price")}
                {posNumField(quantityLabel, "lot_size")}
              </div>

              <div className="grid grid-cols-3 gap-3">
                {posNumField("Stop Loss", "stop_loss")}
                {posNumField("Take Profit", "take_profit")}
                {posNumField("Risk:Reward", "risk_reward")}
              </div>

              {/* PnL Engine result */}
              {calcedPnl && !form.pnl_manual_override && (
                <div className="bg-secondary/30 rounded-lg px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calculator className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Calculated P&L</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-mono font-bold ${calcedPnl.grossPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {calcedPnl.grossPnl >= 0 ? "+" : ""}{calcedPnl.grossPnl.toFixed(2)} gross
                      &nbsp;/&nbsp;
                      {calcedPnl.netPnl >= 0 ? "+" : ""}{calcedPnl.netPnl.toFixed(2)} net
                    </span>
                    <button
                      onClick={() => { handleChange("pnl", calcedPnl.grossPnl.toFixed(2)); handleChange("pnl_manual_override", true); }}
                      className="text-xs text-primary hover:text-primary/80 underline underline-offset-2"
                    >
                      Override
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    P&L
                    {form.pnl_manual_override && (
                      <span className="text-[10px] text-yellow-400 bg-yellow-400/10 px-1 rounded">manual</span>
                    )}
                  </Label>
                  <Input
                    type="number"
                    step="any"
                    value={form.pnl_manual_override ? form.pnl : (calcedPnl ? calcedPnl.grossPnl.toFixed(2) : form.pnl)}
                    onChange={(e) => { handleChange("pnl", e.target.value); handleChange("pnl_manual_override", true); }}
                    className="bg-secondary/50 border-border h-9 font-mono text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                {posNumField("Commission", "commission")}
                {posNumField("Swap", "swap")}
              </div>

              {form.pnl_manual_override && (
                <button
                  onClick={() => handleChange("pnl_manual_override", false)}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  ↩ Reset to calculated P&L
                </button>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Open Time</Label>
                  <DateTimePicker label="Open Time" value={form.open_time} onChange={(v) => handleChange("open_time", v)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Close Time</Label>
                  <DateTimePicker label="Close Time" value={form.close_time} onChange={(v) => handleChange("close_time", v)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Session</Label>
                  <Select value={form.session} onValueChange={(v) => handleChange("session", v)}>
                    <SelectTrigger className="bg-secondary/50 border-border h-9 text-sm">
                      <SelectValue placeholder="Select session" />
                    </SelectTrigger>
                    <SelectContent>
                      {sessions.map(s => (
                        <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Strategy</Label>
                  {strategies.length > 0 ? (
                    <Select value={form.strategy} onValueChange={(v) => handleChange("strategy", v)}>
                      <SelectTrigger className="bg-secondary/50 border-border h-9 text-sm">
                        <SelectValue placeholder="Select strategy" />
                      </SelectTrigger>
                      <SelectContent>
                        {strategies.map(s => (
                          <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={form.strategy}
                      onChange={(e) => handleChange("strategy", e.target.value)}
                      className="bg-secondary/50 border-border h-9 text-sm"
                      placeholder="Strategy name"
                    />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Account</Label>
                  {accounts.length > 0 ? (
                    <Select value={form.account} onValueChange={(v) => handleChange("account", v)}>
                      <SelectTrigger className="bg-secondary/50 border-border h-9 text-sm">
                        <SelectValue placeholder="Select account" />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map(a => (
                          <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={form.account} onChange={(e) => handleChange("account", e.target.value)} className="bg-secondary/50 border-border h-9 text-sm" placeholder="Account name" />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Platform</Label>
                  <Input value={form.platform} onChange={(e) => handleChange("platform", e.target.value)} className="bg-secondary/50 border-border h-9 text-sm" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="journal" className="space-y-4 mt-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => handleChange("notes", e.target.value)}
                  className="bg-secondary/50 border-border min-h-[160px] text-sm"
                  placeholder="What was your plan? How did you execute? What did you learn?"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Screenshots</Label>
                <div className="flex flex-wrap gap-2">
                  {form.screenshots?.map((url, i) => (
                    <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border group">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                      <button
                        onClick={() => setForm(prev => ({ ...prev, screenshots: prev.screenshots.filter((_, idx) => idx !== i) }))}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-destructive/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  ))}
                  <label className="w-20 h-20 rounded-lg border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors">
                    <Upload className="w-5 h-5 text-muted-foreground" />
                    <input type="file" accept="image/*" className="hidden" onChange={handleScreenshot} />
                  </label>
                </div>
                {uploading && <p className="text-xs text-muted-foreground">Uploading...</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Tags (comma separated)</Label>
                <Input
                  value={form.tags?.join(", ") || ""}
                  onChange={(e) => handleChange("tags", e.target.value.split(",").map(t => t.trim()).filter(Boolean))}
                  className="bg-secondary/50 border-border h-9 text-sm"
                  placeholder="breakout, momentum, trend"
                />
              </div>
            </TabsContent>

            <TabsContent value="psychology" className="space-y-5 mt-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Emotion</Label>
                <div className="flex flex-wrap gap-2">
                  {emotions.map(e => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => handleChange("emotion", form.emotion === e ? "" : e)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
                        form.emotion === e
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      }`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground">Trade Rating ({form.rating}/5)</Label>
                <Slider value={[form.rating]} onValueChange={([v]) => handleChange("rating", v)} min={1} max={5} step={1} />
              </div>
              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground">Execution Quality ({form.execution_quality}/10)</Label>
                <Slider value={[form.execution_quality]} onValueChange={([v]) => handleChange("execution_quality", v)} min={1} max={10} step={1} />
              </div>
              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground">Setup Quality ({form.setup_quality}/10)</Label>
                <Slider value={[form.setup_quality]} onValueChange={([v]) => handleChange("setup_quality", v)} min={1} max={10} step={1} />
              </div>
              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground">Discipline ({form.discipline_score}/10)</Label>
                <Slider value={[form.discipline_score]} onValueChange={([v]) => handleChange("discipline_score", v)} min={1} max={10} step={1} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Mistakes (comma separated)</Label>
                <Input
                  value={form.mistakes?.join(", ") || ""}
                  onChange={(e) => handleChange("mistakes", e.target.value.split(",").map(t => t.trim()).filter(Boolean))}
                  className="bg-secondary/50 border-border h-9 text-sm"
                  placeholder="early entry, moved stop, no plan"
                />
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-2 pt-4 border-t border-border">
            <Button variant="outline" onClick={requestClose} className="text-sm">Cancel</Button>
            <Button onClick={handleSubmit} className="text-sm">
              <Save className="w-4 h-4 mr-2" />{trade ? "Update" : "Log"} Trade
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Leave warning */}
      <AlertDialog open={showLeaveWarning} onOpenChange={(open) => { if (!open) setShowLeaveWarning(false); }}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to this trade. What would you like to do?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            {/* AlertDialogCancel is the Radix primitive that properly closes the dialog */}
            <AlertDialogCancel
              className="text-sm"
              onClick={() => setShowLeaveWarning(false)}
            >
              Keep working
            </AlertDialogCancel>
            <AlertDialogAction
              className="text-sm bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/20 hover:text-destructive"
              onClick={handleDiscard}
            >
              Discard changes
            </AlertDialogAction>
            <AlertDialogAction
              className="text-sm"
              onClick={handleSaveDraft}
            >
              Save trade
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
