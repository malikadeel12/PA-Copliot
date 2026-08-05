// --- Change Summary ---
// What: Wire direct PDF download + pass signature stamp into DOCX/PDF exporters.
// Why: Close export polish gaps (true .pdf download; signature image in DOCX).
// Related: exportPdf.js, exportDocx.js, Profile signature_data_url
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { downloadPaFormDocx } from "@/lib/exportDocx";
import { downloadPaFormPdf } from "@/lib/exportPdf";
import {
  FileText, Gauge, Lightbulb, Mail, Download, Printer, CheckCircle2,
  AlertTriangle, ShieldCheck, ClipboardList, LogOut, Wand2,
  Bold, Italic, Signature, RotateCcw, Copy, ArrowLeft, FileType,
} from "lucide-react";
import { resolveJumpTarget, getStepLabel } from "@/components/wizard/suggestionTargets";

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

export default function ResultsStep({ state, patch, onExit, onBack, onJumpToStep }) {
  const { user } = useAuth();
  const r = state.result || {};
  const form = useMemo(() => r.filled_form || {}, [r.filled_form]);
  const analysis = r.analysis || {};
  const suggestions = [...(r.suggestions || [])].sort((a, b) => (a.priority || 9) - (b.priority || 9));
  const letter = r.cover_letter || {};
  const sub = r.submission_info || {};
  const pct = Math.max(0, Math.min(100, analysis.approval_probability_pct ?? 0));
  // Explicit confidence interval (e.g. 72% ± 8%), clamped so range stays in 0–100.
  const rawCi = analysis.confidence_interval_pct ?? (
    analysis.confidence_in_estimate === "High" ? 5 : analysis.confidence_in_estimate === "Medium" ? 8 : 12
  );
  const ci = Math.max(0, Math.min(25, Number(rawCi) || 8));
  const ciLow = Math.max(0, pct - ci);
  const ciHigh = Math.min(100, pct + ci);

  const scoreColor = pct >= 75 ? "#059669" : pct >= 50 ? "#d97706" : "#e11d48";
  const sigIsImage = typeof user?.signature_data_url === "string" && user.signature_data_url.startsWith("data:image");

  // Snapshot the AI's original draft on first render so "Reset to AI draft"
  // always recovers the exact text Claude produced, regardless of subsequent
  // patches to state.result.
  const aiDraftRef = useRef(letter);
  const aiDraft = aiDraftRef.current;

  // Inject a tiny print-only stylesheet that converts the inline markdown
  // markers (**bold**, *italic*) used by the toolbar into real <b>/<i> tags
  // when the doctor hits "Print / PDF". Safe to register repeatedly — browsers
  // dedupe by selector.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const id = "pa-letter-print-styles";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @media print {
        [data-print-letter] strong { font-weight: 700; }
      }
      @media print {
        body.print-scope-panel-form [data-print-outside-panel="panel-form"],
        body.print-scope-panel-form .no-print,
        body.print-scope-panel-form header.sticky,
        body.print-scope-panel-form footer.no-print,
        body.print-scope-panel-form .master-export-bar { display: none !important; }
        body.print-scope-panel-form [data-print-target="panel-form"] {
          position: absolute !important;
          left: 0 !important; top: 0 !important;
          width: 100% !important;
          box-shadow: none !important;
          border: 1px solid #ccc !important;
        }
      }
      @media print {
        body.print-scope-panel-analysis [data-print-outside-panel="panel-analysis"],
        body.print-scope-panel-analysis .no-print,
        body.print-scope-panel-analysis header.sticky,
        body.print-scope-panel-analysis footer.no-print,
        body.print-scope-panel-analysis .master-export-bar { display: none !important; }
        body.print-scope-panel-analysis [data-print-target="panel-analysis"] {
          position: absolute !important;
          left: 0 !important; top: 0 !important;
          width: 100% !important;
          box-shadow: none !important;
          border: 1px solid #ccc !important;
        }
      }
      @media print {
        body.print-scope-panel-suggestions [data-print-outside-panel="panel-suggestions"],
        body.print-scope-panel-suggestions .no-print,
        body.print-scope-panel-suggestions header.sticky,
        body.print-scope-panel-suggestions footer.no-print,
        body.print-scope-panel-suggestions .master-export-bar { display: none !important; }
        body.print-scope-panel-suggestions [data-print-target="panel-suggestions"] {
          position: absolute !important;
          left: 0 !important; top: 0 !important;
          width: 100% !important;
          box-shadow: none !important;
          border: 1px solid #ccc !important;
        }
      }
      @media print {
        body.print-scope-panel-letter [data-print-outside-panel="panel-letter"],
        body.print-scope-panel-letter .no-print,
        body.print-scope-panel-letter header.sticky,
        body.print-scope-panel-letter footer.no-print,
        body.print-scope-panel-letter .master-export-bar { display: none !important; }
        body.print-scope-panel-letter [data-print-target="panel-letter"] {
          position: absolute !important;
          left: 0 !important; top: 0 !important;
          width: 100% !important;
          box-shadow: none !important;
          border: 1px solid #ccc !important;
        }
      }
    `;
    document.head.appendChild(style);
  }, []);

  // Clicking a "Fix / Edit Step" button jumps back to the relevant step
  // (without purging the session) and focuses the offending field. If the
  // target_field is unrecognized we fall back to Step 3 (Validate) — the
  // generic landing spot where the user can manually pick what to fix.
  const jumpToSuggestion = (s) => {
    let target = resolveJumpTarget(s?.target_field);
    let fellBack = false;
    if (!target) {
      // Hard fallback to the Validate step so the button is never a no-op.
      target = { step: 2, focus: "validate-crosswalk", stepLabel: getStepLabel(2) };
      fellBack = true;
    }
    if (!onJumpToStep) return;
    const hint = fellBack
      ? `Jumping back to ${target.stepLabel} — pick the field you want to edit, then re-run analysis.`
      : `Jumping back to ${target.stepLabel} — ${target.focus === "capture-rescan" ? "re-scan or re-enter" : "edit the suggested field"}, then re-run analysis.`;
    toast.info(hint);
    onJumpToStep(target.step, target.focus);
  };

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `pa-package-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Complete package downloaded");
  };

  const exportOptions = () => ({
    signatureDataUrl: user?.signature_data_url || "",
  });

  const downloadDocx = async () => {
    try {
      await downloadPaFormDocx(r, {
        ...exportOptions(),
        filename: `pa-form-${Date.now()}.docx`,
      });
      toast.success("DOCX exported");
    } catch (e) {
      console.error(e);
      toast.error("Could not create the DOCX file.");
    }
  };

  // Direct .PDF download (no print dialog). Print remains available separately.
  const downloadPdf = async () => {
    try {
      await downloadPaFormPdf(r, {
        ...exportOptions(),
        filename: `pa-form-${Date.now()}.pdf`,
      });
      toast.success("PDF downloaded");
    } catch (e) {
      console.error(e);
      toast.error("Could not create the PDF file.");
    }
  };

  // Scope the browser's print dialog to a single panel by toggling a body
  // class (the injected stylesheet hides everything outside the target).
  // After the print dialog returns, the class is removed so normal layout
  // resumes. `null` means "print everything" — the default for the master bar.
  const printScope = (testid, label) => {
    if (typeof document === "undefined") return;
    const body = document.body;
    // Clear any stale scope from a previous print that may have aborted.
    body.classList.forEach((c) => { if (c.startsWith("print-scope-")) body.classList.remove(c); });
    if (testid) body.classList.add(`print-scope-${testid}`);
    toast.info(label || "Opening print dialog.");
    // Defer slightly so the toast + layout settle before the modal opens.
    setTimeout(() => {
      window.print();
      // Best-effort cleanup; if the dialog is still open, the class is
      // harmless until the next print.
      body.classList.forEach((c) => { if (c.startsWith("print-scope-")) body.classList.remove(c); });
    }, 50);
  };

  const panelActions = (testid, label) => (
    <div className="flex items-center gap-1 no-print" data-print-outside-panel={testid}>
      <button
        type="button"
        data-testid={`${testid}-print-btn`}
        aria-label={`Print ${label}`}
        onClick={() => printScope(testid, `Printing ${label}…`)}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-stone-200 bg-white hover:bg-stone-50 text-stone-700"
        title={`Print ${label}`}
      >
        <Printer className="w-3.5 h-3.5" /> Print
      </button>
      <button
        type="button"
        data-testid={`${testid}-pdf-btn`}
        aria-label={`Download ${label} as PDF`}
        onClick={downloadPdf}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-stone-200 bg-white hover:bg-stone-50 text-stone-700"
        title={`Download ${label} as PDF`}
      >
        <Download className="w-3.5 h-3.5" /> PDF
      </button>
    </div>
  );

  const formRows = useMemo(() => ([
    ["Patient", form.patient_name], ["DOB", form.date_of_birth], ["Payer", form.payer_name],
    ["Member ID", form.insured_id_number], ["Prescriber", form.prescriber_name], ["NPI", form.prescriber_npi],
    ["Service code", form.service_code], ["J-Code / NDC", form.jcode_ndc], ["Primary ICD-10", form.primary_icd10],
    ["Quantity", form.quantity_duration], ["Place of service", form.place_of_service], ["Request type", form.request_type],
    ["Modifiers", Array.isArray(form.modifiers) ? form.modifiers.join(", ") : (form.modifiers || "")],
    ["Allergies", form.known_allergies],
  ]), [form]);

  return (
    <div className="animate-fade-in-up">
      <div className="flex items-start justify-between gap-4 flex-wrap no-print">
        <div>
          <button type="button" data-testid="results-back-btn" onClick={onBack} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 mb-2">
            <ArrowLeft className="w-4 h-4" /> Back to validate
          </button>
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">Step 4 · Package</span>
          <h1 className="mt-2 font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-stone-900">Your submission package</h1>
          <p className="mt-2 text-stone-500">Four deliverables, ready to submit. Review, then export — the session purges after.</p>
        </div>
        <div className="flex gap-2 master-export-bar flex-wrap">
          <Button data-testid="master-print-btn" variant="outline" onClick={() => printScope(null, "Opening print dialog for the complete package.")} className="h-11 rounded-xl border-stone-300"><Printer className="w-4 h-4 mr-2" /> Print All</Button>
          <Button data-testid="master-pdf-btn" variant="outline" onClick={downloadPdf} className="h-11 rounded-xl border-stone-300"><Download className="w-4 h-4 mr-2" /> PDF</Button>
          <Button data-testid="master-docx-btn" variant="outline" onClick={downloadDocx} className="h-11 rounded-xl border-stone-300"><FileType className="w-4 h-4 mr-2" /> DOCX</Button>
          <Button data-testid="master-download-btn" onClick={downloadJson} className="h-11 px-6 bg-emerald-900 hover:bg-emerald-800 text-white border border-emerald-950"><Download className="w-4 h-4 mr-2" /> Download Complete Package</Button>
        </div>
      </div>

      <div className="mt-8 grid lg:grid-cols-2 gap-6">
        {/* Panel 2 — Technical Analysis (feature it first, top-left) */}
        <Panel testid="panel-analysis" icon={Gauge} title="Approval Analysis" actions={panelActions("panel-analysis", "Approval Analysis")}>
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
              <div className="mt-1 font-mono text-lg font-semibold text-stone-900" data-testid="approval-ci">
                {pct}% ± {ci}%
              </div>
              <div className="text-[11px] text-stone-400">Range {ciLow}–{ciHigh}%</div>
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
        <Panel testid="panel-suggestions" icon={Lightbulb} title="Suggestions List" actions={panelActions("panel-suggestions", "Suggestions List")}>
          {suggestions.length === 0 && <p className="text-sm text-stone-400">No suggestions — this request looks complete.</p>}
          <div className="space-y-3">
            {suggestions.map((s, i) => {
              const target = resolveJumpTarget(s?.target_field);
              return (
                <div key={i} data-testid={`suggestion-${i}`} className="p-3 rounded-xl border border-stone-200 bg-stone-50/60">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono font-semibold text-stone-400">#{s.priority ?? i + 1}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${impactColor(s.expected_impact)}`}>{s.expected_impact} impact</span>
                  </div>
                  <p className="mt-1.5 text-sm text-stone-800">{s.action}</p>
                  {s.target_field && <p className="mt-1 text-[11px] text-stone-400">→ {s.target_field}</p>}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-stone-400">
                      {target ? `Go to Step ${target.step + 1} · ${target.stepLabel}` : "Go to Validate"}
                    </span>
                    <button
                      type="button"
                      data-testid={`suggestion-${i}-fix-btn`}
                      onClick={() => jumpToSuggestion(s)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:text-emerald-900 bg-white border border-emerald-200 hover:border-emerald-300 rounded-full px-3 py-1 transition-colors"
                    >
                      <Wand2 className="w-3.5 h-3.5" /> Fix / Edit Step
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* Panel 1 — Filled PA Form */}
        <Panel testid="panel-form" icon={FileText} title="Filled PA Form" actions={panelActions("panel-form", "Filled PA Form")}>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {formRows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between border-b border-stone-100 py-1.5">
                <span className="text-[11px] uppercase tracking-wider text-stone-400 font-semibold">{k}</span>
                <span className="font-mono text-xs text-stone-800 text-right">{(v != null && v !== "") ? v : <span className="text-stone-300">—</span>}</span>
              </div>
            ))}
          </div>
          {form.medical_necessity_narrative && (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-1">Medical necessity narrative</div>
              <p className="text-sm text-stone-600 leading-relaxed bg-stone-50 rounded-lg p-3 border border-stone-100">{form.medical_necessity_narrative}</p>
            </div>
          )}
          {(sigIsImage || user?.signature_data_url) && (
            <div className="mt-4 border-t border-stone-100 pt-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2">Digital signature / stamp</div>
              {sigIsImage ? (
                <img src={user.signature_data_url} alt="Prescriber signature" className="max-h-16 object-contain" data-testid="form-signature-image" />
              ) : (
                <p className="font-mono text-sm italic text-stone-700">{user.signature_data_url}</p>
              )}
            </div>
          )}
          <div className="mt-3 no-print">
            <Button data-testid="panel-form-docx-btn" variant="outline" size="sm" onClick={downloadDocx} className="border-stone-300">
              <FileType className="w-3.5 h-3.5 mr-1.5" /> Export form as DOCX
            </Button>
          </div>
        </Panel>

        {/* Panel 4 — Cover letter (editable) + submission */}
        <Panel testid="panel-letter" icon={Mail} title="Cover Letter & Routing" actions={panelActions("panel-letter", "Cover Letter & Routing")}>
          <EditableCoverLetter
            letter={letter}
            aiDraft={aiDraft}
            onChange={(next) => patch({ result: { ...r, cover_letter: next } })}
          />

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

      <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 no-print rounded-lg border border-emerald-200 bg-emerald-50 p-5">
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

function Panel({ icon: Icon, title, testid, actions, children }) {
  return (
    <div
      data-testid={testid}
      data-print-target={testid}
      className="bg-white border border-stone-300 rounded-lg p-6 shadow-sm flex flex-col break-inside-avoid"
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-md border border-stone-200 bg-stone-50 flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4 text-emerald-800" />
          </div>
          <h3 className="font-heading font-semibold text-stone-900 truncate">{title}</h3>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditableCoverLetter
//
// Inline editable cover letter. Header fields (To / Route / Subject) are
// single-line <Input>s. The body and signature block are multi-line
// <Textarea>s so line breaks survive printing and JSON export without any
// HTML injection. B/I toolbar buttons wrap the current selection in
// `**…**` / `*…*` markers; a print stylesheet (registered by the parent)
// renders them as <strong>/<em> when the doctor hits "Print / PDF".
//
// All edits flow back to the parent via `onChange`, which patches
// state.result.cover_letter — keeping JSON export and re-runs in sync.
// ---------------------------------------------------------------------------
function EditableCoverLetter({ letter, aiDraft, onChange }) {
  const { user } = useAuth();
  const bodyRef = useRef(null);

  const update = (patch) => onChange({ ...letter, ...patch });

  const wrapSelection = (marker) => {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = (letter.body || "").slice(start, end);
    const next = (letter.body || "").slice(0, start) + marker + selected + marker + (letter.body || "").slice(end);
    update({ body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = start + marker.length;
      el.selectionEnd = end + marker.length;
    });
  };

  const insertSignature = () => {
    const raw = (user?.signature_data_url || "").trim();
    // Image stamps live on the form panel; for the letter, prefer typed name or profile name.
    const sig = raw.startsWith("data:image") ? (user?.name || "").trim() : raw;
    if (!sig) {
      toast.error(raw.startsWith("data:image")
        ? "Image stamp is on the form. Add your Full name in Profile to insert into the letter."
        : "No saved signature — set one in Profile first.");
      return;
    }
    if (raw.startsWith("data:image")) {
      toast.message("Image stamp stays on the PA form; inserting your name into the letter.");
    }
    const el = bodyRef.current;
    const append = (sig.includes("\n") ? "\n" : " ") + sig;
    if (!el) { update({ body: (letter.body || "") + append }); return; }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = (letter.body || "").slice(0, start) + append + (letter.body || "").slice(end);
    update({ body: next });
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + append.length; });
  };

  const resetToAiDraft = () => {
    onChange({ ...aiDraft });
    toast.success("Cover letter reset to AI draft");
  };

  const copyLetter = async () => {
    const text = [
      letter.to && `To: ${letter.to}`,
      letter.fax_or_portal_route && `Route: ${letter.fax_or_portal_route}`,
      letter.subject && `Subject: ${letter.subject}`,
      letter.body,
      letter.signature_block && `\n—\n${letter.signature_block}`,
    ].filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Cover letter copied");
    } catch { toast.error("Couldn't copy — your browser blocked clipboard access."); }
  };

  const bodyLen = (letter.body || "").length;

  return (
    <div data-print-letter className="space-y-3">
      {/* Inline header fields — read like editable labels, not a separate form. */}
      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">To</Label>
          <Input data-testid="letter-to" value={letter.to || ""} onChange={(e) => update({ to: e.target.value })}
            placeholder="Payer reviewer name / department" className="mt-1 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Route</Label>
          <Input data-testid="letter-route" value={letter.fax_or_portal_route || ""} onChange={(e) => update({ fax_or_portal_route: e.target.value })}
            placeholder="Portal URL or fax number" className="mt-1 h-9 text-sm" />
        </div>
      </div>
      <div>
        <Label className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Subject</Label>
        <Input data-testid="letter-subject" value={letter.subject || ""} onChange={(e) => update({ subject: e.target.value })}
          placeholder="Prior authorization request — patient name" className="mt-1 h-9 text-sm font-medium" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap no-print">
        <div className="flex items-center gap-1">
          <button type="button" data-testid="letter-bold-btn" onClick={() => wrapSelection("**")}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded border border-stone-200 bg-white hover:bg-stone-50 text-stone-700">
            <Bold className="w-3.5 h-3.5" /> B
          </button>
          <button type="button" data-testid="letter-italic-btn" onClick={() => wrapSelection("*")}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs italic rounded border border-stone-200 bg-white hover:bg-stone-50 text-stone-700">
            <Italic className="w-3.5 h-3.5" /> I
          </button>
          <button type="button" data-testid="letter-insert-signature-btn" onClick={insertSignature}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-stone-200 bg-white hover:bg-stone-50 text-stone-700">
            <Signature className="w-3.5 h-3.5" /> Insert signature
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" data-testid="letter-copy-btn" onClick={copyLetter}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-stone-200 bg-white hover:bg-stone-50 text-stone-700">
            <Copy className="w-3.5 h-3.5" /> Copy
          </button>
          <button type="button" data-testid="letter-reset-btn" onClick={resetToAiDraft}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-stone-200 bg-white hover:bg-stone-50 text-stone-700">
            <RotateCcw className="w-3.5 h-3.5" /> Reset to AI draft
          </button>
        </div>
      </div>

      {/* Body editor */}
      <div>
        <Textarea
          ref={bodyRef}
          data-testid="letter-body"
          value={letter.body || ""}
          onChange={(e) => update({ body: e.target.value })}
          placeholder="Edit the cover letter narrative here. Use **bold**, *italic*, and Insert signature above."
          className="min-h-[180px] resize-y text-sm leading-relaxed font-sans bg-stone-50 border-stone-200"
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[11px] text-stone-400">Edits persist to JSON export and Print / PDF.</span>
          <span data-testid="letter-charcount" className="text-[11px] font-mono text-stone-400">{bodyLen} chars</span>
        </div>
      </div>

      {/* Signature block editor */}
      <div>
        <Label className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Signature block</Label>
        <Textarea
          data-testid="letter-signature"
          value={letter.signature_block || ""}
          onChange={(e) => update({ signature_block: e.target.value })}
          placeholder="Closing & signature — e.g. 'Sincerely,\nDr. Sarah Kim, MD\nRiverside Clinic'"
          className="mt-1 min-h-[70px] resize-y text-xs italic font-sans bg-stone-50 border-stone-200"
        />
      </div>
    </div>
  );
}
