import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  FileText, Gauge, Lightbulb, Mail, Download, Printer, CheckCircle2,
  AlertTriangle, ShieldCheck, ClipboardList, LogOut, Sparkles,
} from "lucide-react";

const riskColor = (risk) => ({
  Low: "text-emerald-700 bg-emerald-50 border-emerald-200",
  Medium: "text-amber-700 bg-amber-50 border-amber-200",
  High: "text-rose-700 bg-rose-50 border-rose-200",
}[risk] || "text-stone-600 bg-stone-50 border-stone-200");

const impactColor = (i) => ({
  High: "bg-emerald-600 text-white",
  Medium: "bg-amber-500 text-white",
  Low: "bg-stone-300 text-stone-700",
}[i] || "bg-stone-300 text-stone-700");

export default function ResultsStep({ state, onExit }) {
  const r = state.result || {};
  const form = r.filled_form || {};
  const analysis = r.analysis || {};
  const suggestions = (r.suggestions || []).sort((a, b) => (a.priority || 9) - (b.priority || 9));
  const letter = r.cover_letter || {};
  const sub = r.submission_info || {};
  const pct = Math.max(0, Math.min(100, analysis.approval_probability_pct ?? 0));

  const scoreColor = pct >= 75 ? "#059669" : pct >= 50 ? "#d97706" : "#e11d48";

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `pa-package-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Package downloaded");
  };

  const formRows = useMemo(() => ([
    ["Patient", form.patient_name], ["DOB", form.date_of_birth], ["Payer", form.payer_name],
    ["Member ID", form.insured_id_number], ["Prescriber", form.prescriber_name], ["NPI", form.prescriber_npi],
    ["Service code", form.service_code], ["J-Code / NDC", form.jcode_ndc], ["Primary ICD-10", form.primary_icd10],
    ["Quantity", form.quantity_duration], ["Place of service", form.place_of_service], ["Request type", form.request_type],
    ["Modifiers", (form.modifiers || []).join(", ")], ["Allergies", form.known_allergies],
  ]), [form]);

  return (
    <div className="animate-fade-in-up">
      <div className="flex items-start justify-between gap-4 flex-wrap no-print">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">Step 4 · Package</span>
          <h1 className="mt-2 font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-stone-900">Your submission package</h1>
          <p className="mt-2 text-stone-500">Four deliverables, ready to submit. Review, then export — the session purges after.</p>
        </div>
        <div className="flex gap-2">
          <Button data-testid="export-print-btn" variant="outline" onClick={() => window.print()} className="h-11 rounded-xl border-stone-300"><Printer className="w-4 h-4 mr-2" /> Print / PDF</Button>
          <Button data-testid="export-json-btn" onClick={downloadJson} className="h-11 rounded-md bg-emerald-900 hover:bg-emerald-800 text-white border border-emerald-950"><Download className="w-4 h-4 mr-2" /> Export</Button>
        </div>
      </div>

      <div className="mt-8 grid lg:grid-cols-2 gap-6">
        {/* Panel 2 — Technical Analysis (feature it first, top-left) */}
        <Panel testid="panel-analysis" icon={Gauge} title="Technical Analysis">
          <div className="flex items-center gap-5">
            <div className="relative w-24 h-24 shrink-0">
              <svg viewBox="0 0 100 100" className="w-24 h-24 -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="#f0efec" strokeWidth="10" />
                <circle cx="50" cy="50" r="42" fill="none" stroke={scoreColor} strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={`${(pct / 100) * 264} 264`} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-2xl font-semibold" style={{ color: scoreColor }}>{pct}%</span>
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-stone-400 font-semibold">Approval probability</div>
              <span className={`mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${riskColor(analysis.denial_risk)}`}>
                {analysis.denial_risk || "—"} denial risk
              </span>
              <div className="mt-1.5 text-xs text-stone-400">Estimate confidence: {analysis.confidence_in_estimate || "—"}</div>
            </div>
          </div>

          {(analysis.red_flags || []).length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2">Red flags</div>
              <div className="space-y-2">
                {analysis.red_flags.map((f, i) => (
                  <div key={i} className="flex gap-2 text-sm p-2.5 rounded-lg bg-rose-50/60 border border-rose-100">
                    <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <div><span className="font-medium text-stone-800">{f.issue}</span><span className="text-stone-500"> — {f.why_it_matters}</span></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(analysis.missing_items || []).length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2">Missing items</div>
              <ul className="space-y-1 text-sm text-stone-600 list-disc list-inside">
                {analysis.missing_items.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}

          <div className="mt-4 flex items-start gap-2 text-xs text-stone-400 border-t border-stone-100 pt-3">
            <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {analysis.disclaimer || "This is a decision-support estimate, not a payer guarantee."}
          </div>
        </Panel>

        {/* Panel 3 — Suggestions */}
        <Panel testid="panel-suggestions" icon={Lightbulb} title="Optimization Suggestions">
          {suggestions.length === 0 && <p className="text-sm text-stone-400">No suggestions — this request looks complete.</p>}
          <div className="space-y-3">
            {suggestions.map((s, i) => (
              <div key={i} data-testid={`suggestion-${i}`} className="p-3 rounded-xl border border-stone-200 bg-stone-50/60">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-semibold text-stone-400">#{s.priority ?? i + 1}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${impactColor(s.expected_impact)}`}>{s.expected_impact} impact</span>
                </div>
                <p className="mt-1.5 text-sm text-stone-800">{s.action}</p>
                {s.target_field && <p className="mt-1 text-[11px] text-stone-400">→ {s.target_field}</p>}
              </div>
            ))}
          </div>
        </Panel>

        {/* Panel 1 — Filled PA Form */}
        <Panel testid="panel-form" icon={FileText} title="Filled PA Form">
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {formRows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between border-b border-stone-100 py-1.5">
                <span className="text-[11px] uppercase tracking-wider text-stone-400 font-semibold">{k}</span>
                <span className="font-mono text-xs text-stone-800 text-right">{v || <span className="text-stone-300">null</span>}</span>
              </div>
            ))}
          </div>
          {form.medical_necessity_narrative && (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-1">Medical necessity narrative</div>
              <p className="text-sm text-stone-600 leading-relaxed bg-stone-50 rounded-lg p-3 border border-stone-100">{form.medical_necessity_narrative}</p>
            </div>
          )}
        </Panel>

        {/* Panel 4 — Cover letter + submission */}
        <Panel testid="panel-letter" icon={Mail} title="Cover Letter & Routing">
          <div className="text-sm space-y-1 text-stone-700">
            {letter.to && <div><span className="text-stone-400">To:</span> {letter.to}</div>}
            {letter.fax_or_portal_route && <div><span className="text-stone-400">Route:</span> {letter.fax_or_portal_route}</div>}
            {letter.subject && <div className="font-medium">{letter.subject}</div>}
          </div>
          {letter.body && (
            <pre className="mt-3 text-xs text-stone-600 leading-relaxed whitespace-pre-wrap font-sans bg-stone-50 rounded-lg p-3 border border-stone-100 max-h-56 overflow-auto pa-scroll">{letter.body}</pre>
          )}
          {letter.signature_block && <div className="mt-2 text-xs text-stone-500 italic whitespace-pre-wrap">{letter.signature_block}</div>}

          <div className="mt-4 border-t border-stone-100 pt-3">
            <div className="flex items-center gap-2 text-sm text-stone-800"><ClipboardList className="w-4 h-4 text-emerald-600" /><span className="font-medium">Submission</span></div>
            <div className="mt-2 text-xs text-stone-600 space-y-1">
              <div><span className="text-stone-400">Portal:</span> {sub.recommended_portal || "—"} {sub.portal_category && <span className="text-stone-400">({sub.portal_category})</span>}</div>
              {sub.fallback_fax_or_mail && <div><span className="text-stone-400">Fallback:</span> {sub.fallback_fax_or_mail}</div>}
            </div>
            {(sub.attachments_checklist || []).length > 0 && (
              <ul className="mt-2 space-y-1">
                {sub.attachments_checklist.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-stone-600"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> {a}</li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </div>

      <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 no-print rounded-2xl border border-emerald-100 bg-emerald-50/60 p-5">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          <p className="text-sm text-stone-600">Done? Ending the session immediately purges all data from memory.</p>
        </div>
        <Button data-testid="results-end-btn" onClick={onExit} className="h-11 px-5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl">
          <LogOut className="w-4 h-4 mr-2" /> End session & purge
        </Button>
      </div>
    </div>
  );
}

function Panel({ icon: Icon, title, testid, children }) {
  return (
    <div data-testid={testid} className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm flex flex-col break-inside-avoid">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center"><Icon className="w-4 h-4 text-emerald-600" /></div>
        <h3 className="font-heading font-semibold text-stone-900">{title}</h3>
      </div>
      {children}
    </div>
  );
}
