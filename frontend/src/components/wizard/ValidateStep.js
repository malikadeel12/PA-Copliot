import React, { useState, useEffect } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import {
  ArrowRight, ArrowLeft, Loader2, AlertTriangle, CheckCircle2,
  ShieldQuestion, Layers, Route, Sparkles,
} from "lucide-react";

export default function ValidateStep({ state, patch, onBack, onNext, refreshUser }) {
  const [grids, setGrids] = useState(state.grids);
  const [loading, setLoading] = useState(!state.grids);
  const [generating, setGenerating] = useState(false);

  const [portal, setPortal] = useState("");
  const [selectedCodes, setSelectedCodes] = useState({});
  const [modifiers, setModifiers] = useState([]);
  const [quantity, setQuantity] = useState("");
  const [place, setPlace] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [urgencyText, setUrgencyText] = useState("");

  useEffect(() => {
    if (grids) return;
    (async () => {
      try {
        const { data } = await api.get(`/pa/${state.requestId}/grids`);
        setGrids(data);
        patch({ grids: data });
        setPortal(data.portal_match?.portal || "");
        const preselect = {};
        (data.crosswalk || []).forEach((row, i) => { if (row.code && !row.ambiguous) preselect[i] = true; });
        setSelectedCodes(preselect);
      } catch (e) {
        toast.error(formatApiError(e.response?.data?.detail));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMod = (code) =>
    setModifiers((m) => (m.includes(code) ? m.filter((x) => x !== code) : [...m, code]));

  const hasAmbiguousUnconfirmed = (grids?.crosswalk || []).some((r, i) => r.ambiguous && !selectedCodes[i]);

  const runAnalysis = async () => {
    const confirmed = (grids?.crosswalk || []).filter((_, i) => selectedCodes[i]).map((r) => ({ icd10: r.icd10, code: r.code }));
    const confirmations = {
      recommended_portal: portal,
      portal_category: grids?.portals?.find((p) => p.portal === portal)?.category || null,
      confirmed_codes: confirmed,
      modifiers, quantity_duration: quantity || null, place_of_service: place || null,
      urgent, urgency_justification: urgent ? urgencyText : null,
      request_type: grids?.request_type || "Initial",
    };
    setGenerating(true);
    try {
      await api.post(`/pa/${state.requestId}/confirm`, confirmations);
      const { data } = await api.post(`/pa/${state.requestId}/generate`);
      patch({ confirmations, result: data.result });
      await refreshUser();
      toast.success("Analysis complete");
      onNext();
    } catch (e) {
      const status = e.response?.status;
      if (status === 402) toast.error("Out of credits — please buy more to run the analysis.");
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

  return (
    <div className="animate-fade-in-up">
      <span className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">Step 3 · Validate & Analyze</span>
      <h1 className="mt-2 font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-stone-900">Confirm codes & routing</h1>
      <p className="mt-2 text-stone-500 max-w-xl">Confirm the payer portal, code cross-walk, modifiers and quantity. Then run the single AI reasoning pass.</p>

      <div className="mt-8 grid lg:grid-cols-2 gap-4">
        {/* Payer portal */}
        <div className="rounded-2xl bg-white border border-stone-200 p-5 shadow-sm">
          <div className="flex items-center gap-2 text-stone-800"><Route className="w-4 h-4 text-emerald-600" /><span className="font-heading font-semibold text-sm">Payer Portal Destination</span></div>
          {grids?.portal_match?.auto_matched && <span className="mt-2 inline-block text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">Auto-matched from insurance card</span>}
          <Select value={portal} onValueChange={setPortal}>
            <SelectTrigger data-testid="validate-portal-select" className="mt-3 h-11"><SelectValue placeholder="Select portal" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {(grids?.portals || []).map((p) => (
                <SelectItem key={p.portal} value={p.portal}>{p.portal} · <span className="text-stone-400">{p.category}</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Quantity + place */}
        <div className="rounded-2xl bg-white border border-stone-200 p-5 shadow-sm">
          <div className="flex items-center gap-2 text-stone-800"><Layers className="w-4 h-4 text-emerald-600" /><span className="font-heading font-semibold text-sm">Quantity & Place of Service</span></div>
          <Select value={quantity} onValueChange={setQuantity}>
            <SelectTrigger data-testid="validate-quantity-select" className="mt-3 h-11"><SelectValue placeholder="Quantity / duration" /></SelectTrigger>
            <SelectContent>{(grids?.presets?.quantity_presets || []).map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={place} onValueChange={setPlace}>
            <SelectTrigger data-testid="validate-place-select" className="mt-3 h-11"><SelectValue placeholder="Place of service" /></SelectTrigger>
            <SelectContent>{(grids?.presets?.place_of_service || []).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {/* Code cross-walk */}
      <div className="mt-4 rounded-2xl bg-white border border-stone-200 p-5 shadow-sm">
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

      {/* Modifiers */}
      <div className="mt-4 rounded-2xl bg-white border border-stone-200 p-5 shadow-sm">
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

      {/* Urgency */}
      <div className="mt-4 rounded-2xl bg-white border border-stone-200 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-heading font-semibold text-sm text-stone-800">Urgent request</span>
            <p className="text-xs text-stone-400">Toggle if immediate clinical risk requires expedited review.</p>
          </div>
          <Switch data-testid="validate-urgent-switch" checked={urgent} onCheckedChange={setUrgent} />
        </div>
        {urgent && (
          <Textarea data-testid="validate-urgency-text" value={urgencyText} onChange={(e) => setUrgencyText(e.target.value)}
            maxLength={250} placeholder="Summarize the immediate clinical risk (max 250 chars)…" className="mt-3 min-h-[70px]" />
        )}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <Button data-testid="validate-back-btn" variant="ghost" onClick={onBack} className="text-stone-500"><ArrowLeft className="w-4 h-4 mr-1.5" /> Back</Button>
        <Button data-testid="validate-analyze-btn" onClick={runAnalysis} disabled={generating}
          className="h-12 px-6 bg-emerald-900 hover:bg-emerald-800 text-white font-semibold rounded-md border border-emerald-950 transition-colors">
          {generating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing… (~15s)</> : <><Sparkles className="w-4 h-4 mr-2" /> Run AI analysis (1 credit)</>}
        </Button>
      </div>
    </div>
  );
}
