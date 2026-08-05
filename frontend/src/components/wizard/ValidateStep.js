// --- Change Summary ---
// What: Restore crosswalk selections; refetch grids when OCR/request changes.
// Why: Fixes false credit charges + stale codes after Back / OCR edits.
// Related: CaptureStep (clears grids), POST /pa/:id/generate smart re-run

import React, { useState, useEffect, useCallback } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import VoiceMicButton from "@/components/VoiceMicButton";
import { toast } from "sonner";
import {
  ArrowRight, ArrowLeft, Loader2, AlertTriangle, CheckCircle2,
  ShieldQuestion, Layers, Route, Sparkles, Eye,
} from "lucide-react";

function restoreSelectedCodes(crosswalk, confirmations) {
  const selected = {};
  const confirmed = confirmations?.confirmed_codes || [];
  if (confirmed.length) {
    (crosswalk || []).forEach((row, i) => {
      const match = confirmed.some(
        (c) => c.icd10 === row.icd10 && (c.code || null) === (row.code || null)
      );
      if (match) selected[i] = true;
    });
    return selected;
  }
  // First visit: auto-check unambiguous rows.
  (crosswalk || []).forEach((row, i) => {
    if (row.code && !row.ambiguous) selected[i] = true;
  });
  return selected;
}

export default function ValidateStep({ state, patch, onBack, onNext, refreshUser }) {
  const [grids, setGrids] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const [portal, setPortal] = useState("");
  const [selectedCodes, setSelectedCodes] = useState({});
  const [modifiers, setModifiers] = useState([]);
  const [quantity, setQuantity] = useState("");
  const [place, setPlace] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [urgencyText, setUrgencyText] = useState("");

  // Fingerprint so we refetch when OCR or session identity changes.
  const gridsKey = `${state.requestId || ""}::${state.extractedData?.DiagnosisInformation?.PrimaryICD10Code || ""}::${state.extractedData?.InsuranceInformation?.PayerName || ""}`;

  const applyGrids = useCallback((data, confirmations) => {
    setGrids(data);
    patch({ grids: data });
    setPortal(confirmations?.recommended_portal || data.portal_match?.portal || "");
    setModifiers(confirmations?.modifiers || []);
    setQuantity(confirmations?.quantity_duration || "");
    setPlace(confirmations?.place_of_service || "");
    setUrgent(!!confirmations?.urgent);
    setUrgencyText(confirmations?.urgency_justification || "");
    setSelectedCodes(restoreSelectedCodes(data.crosswalk, confirmations));
  }, [patch]);

  useEffect(() => {
    let cancelled = false;
    if (!state.requestId) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    (async () => {
      try {
        // Always refetch from server when OCR/request fingerprint changes so
        // Validate never shows a stale crosswalk after Capture edits.
        const { data } = await api.get(`/pa/${state.requestId}/grids`);
        if (cancelled) return;
        applyGrids(data, state.confirmations);
      } catch (e) {
        if (!cancelled) toast.error(formatApiError(e.response?.data?.detail));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridsKey]);

  const toggleMod = (code) =>
    setModifiers((m) => (m.includes(code) ? m.filter((x) => x !== code) : [...m, code]));

  const hasAmbiguousUnconfirmed = (grids?.crosswalk || []).some((r, i) => r.ambiguous && !selectedCodes[i]);

  const buildConfirmations = () => {
    const confirmed = (grids?.crosswalk || []).filter((_, i) => selectedCodes[i]).map((r) => ({ icd10: r.icd10, code: r.code }));
    return {
      recommended_portal: portal,
      portal_category: grids?.portals?.find((p) => p.portal === portal)?.category || null,
      confirmed_codes: confirmed,
      modifiers, quantity_duration: quantity || null, place_of_service: place || null,
      urgent, urgency_justification: urgent ? urgencyText : null,
      request_type: grids?.request_type || "Initial",
    };
  };

  const runAnalysis = async () => {
    const confirmations = buildConfirmations();
    if (!(confirmations.confirmed_codes || []).length) {
      toast.error("Select at least one ICD-10 → code mapping before running analysis.");
      return;
    }
    setGenerating(true);
    setPreviewOpen(false);
    try {
      await api.post(`/pa/${state.requestId}/confirm`, confirmations);
      const { data } = await api.post(`/pa/${state.requestId}/generate`, undefined, { timeout: 240000 });
      patch({ confirmations, result: data.result });
      await refreshUser();
      if (data.reused) toast.success("No changes detected — reused prior analysis (no credit used)");
      else toast.success("Analysis complete");
      onNext();
    } catch (e) {
      const status = e.response?.status;
      const code = e.response?.data?.error_code;
      if (status === 402) {
        // Refresh so header credits match server (trial zero-out / spent balance).
        try { await refreshUser(); } catch { /* ignore */ }
        toast.error(
          code === "TRIAL_EXPIRED"
            ? (e.response?.data?.detail || "Your free trial has ended. Please buy credits to continue.")
            : "Out of credits — please buy more to run the analysis."
        );
      } else if (e.code === "ECONNABORTED" || /timeout/i.test(e.message || "")) {
        toast.error("AI analysis is taking longer than expected. Please try again.");
      } else if (!e.response) {
        toast.error("Could not reach the analysis server. Check your connection and try again.");
      }
      else toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 animate-fade-in-up">
        <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
        <p className="mt-4 text-stone-500 text-sm">Cross-walking codes & matching payer portal…</p>
      </div>
    );
  }

  const pi = state.extractedData?.PatientInformation || {};
  const ins = state.extractedData?.InsuranceInformation || {};
  const confirmedPreview = (grids?.crosswalk || []).filter((_, i) => selectedCodes[i]).map((r) => r.code).filter(Boolean);

  return (
    <div className="animate-fade-in-up">
      <span className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">Step 3 · Validate & Analyze</span>
      <h1 className="mt-2 font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-stone-900">Confirm codes & routing</h1>
      <p className="mt-2 text-stone-500 max-w-xl">Confirm the payer portal, code cross-walk, modifiers and quantity. Preview, then run the AI pass — unchanged inputs do not consume another credit.</p>

      <div className="mt-8 grid lg:grid-cols-2 gap-4">
        <div className="rounded-lg bg-white border border-stone-300 p-5 shadow-sm">
          <div className="flex items-center gap-2 text-stone-800"><Route className="w-4 h-4 text-emerald-600" /><span className="font-heading font-semibold text-sm">Payer Portal Destination</span></div>
          {grids?.portal_match?.auto_matched && <span className="mt-2 inline-block text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">Auto-matched from insurance card</span>}
          <Select value={portal} onValueChange={setPortal}>
            <SelectTrigger data-testid="validate-portal-select" data-jump-focus="validate-portal-select" className="mt-3 h-11"><SelectValue placeholder="Select portal" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {(grids?.portals || []).map((p) => (
                <SelectItem key={p.portal} value={p.portal}>{p.portal} · <span className="text-stone-400">{p.category}</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg bg-white border border-stone-300 p-5 shadow-sm">
          <div className="flex items-center gap-2 text-stone-800"><Layers className="w-4 h-4 text-emerald-600" /><span className="font-heading font-semibold text-sm">Quantity & Place of Service</span></div>
          <Select value={quantity} onValueChange={setQuantity}>
            <SelectTrigger data-testid="validate-quantity-select" data-jump-focus="validate-quantity-select" className="mt-3 h-11"><SelectValue placeholder="Quantity / duration" /></SelectTrigger>
            <SelectContent>{(grids?.presets?.quantity_presets || []).map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={place} onValueChange={setPlace}>
            <SelectTrigger data-testid="validate-place-select" data-jump-focus="validate-place-select" className="mt-3 h-11"><SelectValue placeholder="Place of service" /></SelectTrigger>
            <SelectContent>{(grids?.presets?.place_of_service || []).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div data-jump-focus="validate-crosswalk" className="mt-4 rounded-lg bg-white border border-stone-300 p-5 shadow-sm">
        <div className="flex items-center gap-2 text-stone-800"><ShieldQuestion className="w-4 h-4 text-emerald-600" /><span className="font-heading font-semibold text-sm">Code Binding & Cross-Walk</span></div>
        <p className="text-xs text-stone-400 mt-1">Confirm each ICD-10 → procedure/drug code mapping. Low confidence must be reviewed.</p>
        <div className="mt-3 space-y-2">
          {(grids?.crosswalk || []).length === 0 && <p className="text-sm text-stone-400">No diagnosis codes extracted.</p>}
          {(grids?.crosswalk || []).map((row, i) => (
            <label key={i} data-testid={`crosswalk-row-${i}`}
              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors
                ${selectedCodes[i] ? "border-emerald-300 bg-emerald-50/50" : "border-stone-200 hover:bg-stone-50"}`}>
              <input type="checkbox" data-testid={`crosswalk-check-${i}`} checked={!!selectedCodes[i]}
                onChange={(e) => setSelectedCodes((s) => ({ ...s, [i]: e.target.checked }))}
                className="w-4 h-4 accent-emerald-600" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold text-stone-800">{row.icd10}</span>
                  <ArrowRight className="w-3 h-3 text-stone-300" />
                  <span className="font-mono text-sm text-emerald-700">{row.code || "— no preset —"}</span>
                  {row.description && <span className="text-xs text-stone-500">({row.description})</span>}
                </div>
                <span className="text-[11px] text-stone-400">{row.policy}</span>
              </div>
              {row.ambiguous ? (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
                  <AlertTriangle className="w-3 h-3" /> {row.code ? `Ambiguous ${(row.confidence * 100) | 0}%` : "Review"}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full">
                  <CheckCircle2 className="w-3 h-3" /> {(row.confidence * 100) | 0}%
                </span>
              )}
            </label>
          ))}
        </div>
        {hasAmbiguousUnconfirmed && (
          <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5" /> Ambiguous matches should be reviewed and confirmed before analysis.
          </div>
        )}
      </div>

      <div data-jump-focus="validate-modifiers" className="mt-4 rounded-lg bg-white border border-stone-300 p-5 shadow-sm">
        <span className="font-heading font-semibold text-sm text-stone-800">Applicable modifiers</span>
        <div className="mt-3 flex flex-wrap gap-2">
          {(grids?.presets?.modifier_presets || []).slice(0, 16).map((m) => (
            <button key={m.code} data-testid={`modifier-${m.code}`} title={m.meaning} onClick={() => toggleMod(m.code)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border transition-colors
                ${modifiers.includes(m.code) ? "bg-emerald-600 text-white border-emerald-600" : "bg-stone-50 text-stone-600 border-stone-200 hover:border-emerald-300"}`}>
              {m.code}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-white border border-stone-300 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-heading font-semibold text-sm text-stone-800">Urgent request</span>
            <p className="text-xs text-stone-400">Toggle if immediate clinical risk requires expedited review. Use the mic for rapid dictation.</p>
          </div>
          <Switch data-testid="validate-urgent-switch" data-jump-focus="validate-urgent-switch" checked={urgent} onCheckedChange={setUrgent} />
        </div>
        {urgent && (
          <div className="mt-3 flex gap-2 items-start">
            <Textarea data-testid="validate-urgency-text" data-jump-focus="validate-urgency-text" value={urgencyText} onChange={(e) => setUrgencyText(e.target.value)}
              maxLength={250} placeholder="Summarize the immediate clinical risk (max 250 chars)…" className="min-h-[70px] flex-1" />
            <VoiceMicButton value={urgencyText} onTranscript={setUrgencyText} maxLength={250} />
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between gap-3 flex-wrap">
        <Button data-testid="validate-back-btn" variant="ghost" onClick={onBack} className="text-stone-500"><ArrowLeft className="w-4 h-4 mr-1.5" /> Back</Button>
        <Button data-testid="validate-analyze-btn" onClick={() => setPreviewOpen(true)} disabled={generating}
          className="h-12 px-6 bg-emerald-900 hover:bg-emerald-800 text-white font-semibold rounded-md border border-emerald-950 transition-colors">
          {generating
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing…</>
            : <><Eye className="w-4 h-4 mr-2" /> {state.result ? "Preview & continue (free if unchanged)" : "Preview & run analysis"}</>}
        </Button>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg" data-testid="generate-preview-dialog">
          <DialogTitle className="font-heading text-xl">Preview before analysis</DialogTitle>
          <DialogDescription className="text-stone-500">
            Confirm the package inputs. If nothing changed since the last run, no credit is charged.
          </DialogDescription>
          <div className="mt-4 space-y-2 text-sm border border-stone-200 rounded-lg p-4 bg-stone-50">
            <div className="flex justify-between gap-3"><span className="text-stone-500">Patient</span><span className="font-mono text-stone-900">{pi.PatientName || "—"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-stone-500">DOB</span><span className="font-mono text-stone-900">{pi.DateOfBirth || "—"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-stone-500">Payer</span><span className="font-mono text-stone-900">{ins.PayerName || "—"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-stone-500">Member ID</span><span className="font-mono text-stone-900">{ins.InsuredIDNumber || "—"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-stone-500">Portal</span><span className="font-mono text-stone-900 truncate max-w-[55%]">{portal || "—"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-stone-500">Codes</span><span className="font-mono text-stone-900">{confirmedPreview.join(", ") || "— none selected —"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-stone-500">Quantity</span><span className="font-mono text-stone-900">{quantity || "—"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-stone-500">Place</span><span className="font-mono text-stone-900">{place || "—"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-stone-500">Modifiers</span><span className="font-mono text-stone-900">{modifiers.join(", ") || "—"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-stone-500">Urgent</span><span className="font-mono text-stone-900">{urgent ? "Yes" : "No"}</span></div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPreviewOpen(false)} className="border-stone-300">Cancel</Button>
            <Button data-testid="preview-confirm-run-btn" onClick={runAnalysis} disabled={generating}
              className="bg-emerald-900 hover:bg-emerald-800 text-white border border-emerald-950">
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Sparkles className="w-4 h-4 mr-2" /> Confirm & run (1 credit if changed)</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
