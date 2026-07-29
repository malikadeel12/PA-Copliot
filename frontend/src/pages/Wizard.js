import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Activity, X, Check } from "lucide-react";
import { TrustBadge } from "@/components/TrustBadge";
import CaptureStep from "@/components/wizard/CaptureStep";
import DictationStep from "@/components/wizard/DictationStep";
import ValidateStep from "@/components/wizard/ValidateStep";
import ResultsStep from "@/components/wizard/ResultsStep";
import api from "@/lib/api";

const STEP_LABELS = ["Capture", "Dictate", "Validate", "Package"];

export default function Wizard() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
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
      try { await api.post(`/pa/${state.requestId}/end`); } catch {}
    }
    await refreshUser();
    navigate("/dashboard");
  };

  // Jump back to a previous step from the Package panel so the user can fix
  // the suggested field, then re-run analysis. Unlike `exitWizard` this does
  // NOT purge the in-memory session — the user is still iterating on the
  // same PA request.
  const jumpToStep = (stepIndex, focusKey) => {
    setStep(stepIndex);
    setState((s) => ({ ...s, result: null })); // clear stale result; they'll re-run
    pendingFocus.current = focusKey || null;
  };

  // After a step re-renders following a jump, scroll + focus the matching
  // control (or just the top of the step as a graceful fallback).
  const pendingFocus = useRef(null);
  useEffect(() => {
    const key = pendingFocus.current;
    pendingFocus.current = null;
    if (!key) return;
    // Wait for the step to mount + its data to load.
    const tryFocus = (tries = 12) => {
      const node = document.querySelector(`[data-jump-focus="${key}"]`);
      if (node) {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
        if (typeof node.focus === "function") {
          try { node.focus({ preventScroll: true }); } catch { /* not all elements accept focus */ }
        }
      } else if (tries > 0) {
        setTimeout(() => tryFocus(tries - 1), 80);
      }
    };
    setTimeout(() => tryFocus(), 60);
  }, [step]);

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Sticky wizard header */}
      <header className="sticky top-0 z-50 bg-white border-b border-stone-200 no-print">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <img src="/pa-logo.png" alt="PA Copilot logo" className="w-8 h-8 object-contain" />
            <span className="font-heading font-bold text-stone-900 hidden sm:inline">PA Copilot</span>
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

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 pt-8 pb-24">
        {step === 0 && <CaptureStep state={state} patch={patch} onNext={() => setStep(1)} />}
        {step === 1 && <DictationStep state={state} patch={patch} onBack={() => setStep(0)} onNext={() => setStep(2)} />}
        {step === 2 && <ValidateStep state={state} patch={patch} onBack={() => setStep(1)} onNext={() => setStep(3)} refreshUser={refreshUser} />}
        {step === 3 && <ResultsStep state={state} patch={patch} onExit={exitWizard} onJumpToStep={jumpToStep} />}
      </main>

      <footer className="no-print border-t border-stone-200 bg-white py-4">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex items-center justify-center">
          <TrustBadge label="Session-only · purges on export or after 30 min" />
        </div>
      </footer>
    </div>
  );
}
