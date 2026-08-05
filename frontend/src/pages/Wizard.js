// --- Change Summary ---
// What: Sticky patient metadata bar, in-app Back, username/clinic in header.
// Why: Features 5 & 9 — persistent patient context + branding during PA runs.
// Related: CaptureStep, ValidateStep, ResultsStep, AppShell

import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { X, Check, ArrowLeft } from "lucide-react";
import { TrustBadge } from "@/components/TrustBadge";
import CaptureStep from "@/components/wizard/CaptureStep";
import DictationStep from "@/components/wizard/DictationStep";
import ValidateStep from "@/components/wizard/ValidateStep";
import ResultsStep from "@/components/wizard/ResultsStep";
import api from "@/lib/api";

const STEP_LABELS = ["Capture", "Dictate", "Validate", "Package"];

function PatientMetaBar({ extracted }) {
  const pi = extracted?.PatientInformation || {};
  const ins = extracted?.InsuranceInformation || {};
  const cells = [
    { label: "Patient", value: pi.PatientName },
    { label: "DOB", value: pi.DateOfBirth },
    { label: "Member ID", value: ins.InsuredIDNumber },
    { label: "Payer", value: ins.PayerName },
  ];
  if (!cells.some((c) => c.value)) return null;
  return (
    <div
      data-testid="patient-meta-bar"
      className="sticky top-16 z-40 border-b border-stone-200 bg-emerald-50/95 backdrop-blur-sm no-print"
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {cells.map((c) => (
          <div key={c.label} className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800/70">{c.label}</div>
            <div className="font-mono text-xs sm:text-sm text-stone-900 truncate" title={c.value || ""}>
              {c.value || "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Wizard() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const [step, setStep] = useState(0);
  const [state, setState] = useState({
    requestId: null,
    extractedData: null,
    transcript: "",
    grids: null,
    confirmations: null,
    result: null,
  });

  const patch = (p) => setState((s) => ({ ...s, ...p }));

  const exitWizard = async () => {
    if (state.requestId) {
      try { await api.post(`/pa/${state.requestId}/end`); } catch { /* ignore */ }
    }
    await refreshUser();
    navigate("/dashboard");
  };

  // Jump back without purging session. Keep result so unchanged re-runs
  // can reuse the cached package (no credit charge).
  const jumpToStep = (stepIndex, focusKey) => {
    setStep(stepIndex);
    pendingFocus.current = focusKey || null;
  };

  const goBack = () => {
    if (step <= 0) return;
    setStep((s) => s - 1);
  };

  const pendingFocus = useRef(null);
  useEffect(() => {
    const key = pendingFocus.current;
    pendingFocus.current = null;
    if (!key) return;
    const tryFocus = (tries = 12) => {
      const node = document.querySelector(`[data-jump-focus="${key}"]`);
      if (node) {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
        if (typeof node.focus === "function") {
          try { node.focus({ preventScroll: true }); } catch { /* ignore */ }
        }
      } else if (tries > 0) {
        setTimeout(() => tryFocus(tries - 1), 80);
      }
    };
    setTimeout(() => tryFocus(), 60);
  }, [step]);

  const displayName = user?.name || user?.email || "Prescriber";
  const clinic = user?.facility_name || "";

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <header className="sticky top-0 z-50 bg-white border-b border-stone-200 no-print">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            {step > 0 && (
              <button
                type="button"
                data-testid="wizard-back-header"
                onClick={goBack}
                className="w-8 h-8 rounded-full flex items-center justify-center text-stone-500 hover:bg-stone-100 hover:text-stone-800 transition-colors shrink-0"
                title="Back to previous step"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <img src="/brand/pa-logo.png" alt="PA Copilot logo" className="w-8 h-8 object-contain shrink-0" />
            <div className="min-w-0 hidden sm:block">
              <div className="font-heading font-bold text-stone-900 leading-tight">PA Copilot</div>
              <div className="text-[10px] text-stone-500 truncate" data-testid="wizard-user-clinic">
                {displayName}{clinic ? ` · ${clinic}` : ""}
              </div>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center gap-1.5 sm:gap-3">
            {STEP_LABELS.map((label, i) => (
              <div key={label} className="flex items-center gap-1.5 sm:gap-3">
                <div className="flex items-center gap-2" data-testid={`wizard-step-${i}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all
                    ${i < step ? "bg-emerald-600 text-white" : i === step ? "bg-emerald-600 text-white ring-4 ring-emerald-100" : "bg-stone-100 text-stone-400"}`}>
                    {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
                  </div>
                  <span className={`text-sm font-medium hidden md:inline ${i === step ? "text-stone-900" : "text-stone-400"}`}>{label}</span>
                </div>
                {i < STEP_LABELS.length - 1 && <div className={`w-4 sm:w-8 h-px ${i < step ? "bg-emerald-500" : "bg-stone-200"}`} />}
              </div>
            ))}
          </div>

          <button data-testid="wizard-exit" onClick={exitWizard} className="w-8 h-8 rounded-full flex items-center justify-center text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      <PatientMetaBar extracted={state.extractedData} />

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 pt-8 pb-24">
        {step === 0 && <CaptureStep state={state} patch={patch} onNext={() => setStep(1)} />}
        {step === 1 && (
          <DictationStep
            state={state}
            patch={patch}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && <ValidateStep state={state} patch={patch} onBack={() => setStep(1)} onNext={() => setStep(3)} refreshUser={refreshUser} />}
        {step === 3 && <ResultsStep state={state} patch={patch} onExit={exitWizard} onBack={() => setStep(2)} onJumpToStep={jumpToStep} />}
      </main>

      <footer className="no-print border-t border-stone-200 bg-white py-4">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex items-center justify-center">
          <TrustBadge label="Zero-database privacy · Instant ephemeral cleanup" />
        </div>
      </footer>
    </div>
  );
}
