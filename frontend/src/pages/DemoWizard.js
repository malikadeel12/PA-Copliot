import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, FileText, IdCard,
  CreditCard, Loader2, RefreshCw, Route, ShieldCheck, Sparkles, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TrustBadge } from "@/components/TrustBadge";
import ResultsStep from "@/components/wizard/ResultsStep";

const STEP_LABELS = ["Capture", "Dictate", "Validate", "Package"];

const DEMO_DOCUMENTS = [
  { key: "id", icon: IdCard, title: "Patient ID", detail: "Driver's license or government ID" },
  { key: "insurance", icon: CreditCard, title: "Insurance card", detail: "Front or back of the member card" },
  { key: "clinical", icon: FileText, title: "Clinical / order doc", detail: "Progress note, prescription, or order" },
];

const DEMO_TRANSCRIPT = "Requesting initial authorization for Jane A. Doe, date of birth April 12, 1979. The primary diagnosis is rheumatoid arthritis with rheumatoid factor. The patient has persistent joint pain and morning stiffness despite an adequate trial of methotrexate. Humira 40 mg every other week is medically necessary to control disease activity and prevent further joint damage.";

const DEMO_RESULT = {
  filled_form: {
    patient_name: "Jane A. Doe",
    date_of_birth: "1979-04-12",
    payer_name: "UnitedHealthcare",
    insured_id_number: "UHC998877665",
    prescriber_name: "Dr. Sarah Kim, MD",
    prescriber_npi: "1932455678",
    service_code: "J0135",
    jcode_ndc: "00074-4339-02",
    primary_icd10: "M05.79",
    quantity_duration: "2 pens per 28 days",
    place_of_service: "Office (11)",
    request_type: "Initial",
    modifiers: [],
    known_allergies: "No known drug allergies",
    medical_necessity_narrative: "The patient has active rheumatoid arthritis with persistent symptoms despite an adequate methotrexate trial. Adalimumab is requested to reduce disease activity, prevent progressive joint damage, and improve functional status.",
  },
  analysis: {
    approval_probability_pct: 88,
    denial_risk: "Low",
    confidence_in_estimate: "High",
    red_flags: [],
    missing_items: ["Attach the latest tuberculosis screening result before submission."],
    disclaimer: "Demo decision-support estimate only; final coverage is determined by the payer.",
  },
  suggestions: [
    { priority: 1, expected_impact: "High", action: "Attach the most recent negative tuberculosis screening result.", target_field: "Clinical attachments" },
    { priority: 2, expected_impact: "Medium", action: "Include exact methotrexate trial dates and the reason therapy was discontinued.", target_field: "Previous therapy" },
    { priority: 3, expected_impact: "Low", action: "Add the latest disease activity score to strengthen the medical-necessity narrative.", target_field: "Clinical notes" },
  ],
  cover_letter: {
    to: "UnitedHealthcare Prior Authorization Department",
    fax_or_portal_route: "UnitedHealthcare Provider Portal",
    subject: "Prior Authorization Request — Humira for Jane A. Doe",
    body: "To the Prior Authorization Review Team:\n\nPlease review the enclosed request for Humira 40 mg for Jane A. Doe, who has active rheumatoid arthritis despite an adequate methotrexate trial. The attached clinical documentation supports medical necessity and the requested dosing regimen.\n\nThank you for your prompt review.",
    signature_block: "Sarah Kim, MD\nRheumatology\nNPI 1932455678",
  },
  submission_info: {
    recommended_portal: "UnitedHealthcare Provider Portal",
    portal_category: "Payer portal",
    fallback_fax_or_mail: "Use the plan-specific PA fax number shown on the member card.",
    attachments_checklist: ["Completed PA form", "Clinical progress note", "Medication order", "Insurance card", "Tuberculosis screening result"],
  },
};

export default function DemoWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [documents, setDocuments] = useState({ id: null, insurance: null, clinical: null });
  const [documentsReady, setDocumentsReady] = useState(false);
  const [transcript, setTranscript] = useState(DEMO_TRANSCRIPT);
  const [analyzing, setAnalyzing] = useState(false);
  const fileInputs = useRef({});

  const uploadedCount = Object.values(documents).filter(Boolean).length;

  const selectDocument = (key, file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select a JPEG, PNG, or other image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Please select an image smaller than 10 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setDocuments((current) => ({
        ...current,
        [key]: { name: file.name, preview: reader.result },
      }));
      setDocumentsReady(false);
    };
    reader.onerror = () => toast.error("That image could not be opened. Please try another file.");
    reader.readAsDataURL(file);
  };

  const simulateExtraction = () => {
    if (uploadedCount === 0) {
      toast.error("Add at least one document first.");
      return;
    }
    setDocumentsReady(false);
    toast.info("Reading documents…");
    setTimeout(() => {
      setDocumentsReady(true);
      toast.success("Documents read successfully");
    }, 1200);
  };

  const simulateAnalysis = () => {
    setAnalyzing(true);
    setTimeout(() => {
      setAnalyzing(false);
      setStep(3);
      toast.success("Demo analysis complete");
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <header className="sticky top-0 z-50 bg-white border-b border-stone-200 no-print">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <img src="/pa-logo.png" alt="PA Copilot logo" className="w-8 h-8 object-contain" />
            <span className="font-heading font-bold text-stone-900 hidden sm:inline">PA Copilot</span>
          </div>
          <div className="flex-1 flex items-center justify-center gap-1.5 sm:gap-3">
            {STEP_LABELS.map((label, index) => (
              <div key={label} className="flex items-center gap-1.5 sm:gap-3">
                <div className="flex items-center gap-2" data-testid={`demo-step-${index}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${index < step ? "bg-emerald-600 text-white" : index === step ? "bg-emerald-600 text-white ring-4 ring-emerald-100" : "bg-stone-100 text-stone-400"}`}>
                    {index < step ? <Check className="w-3.5 h-3.5" /> : index + 1}
                  </div>
                  <span className={`text-sm font-medium hidden md:inline ${index === step ? "text-stone-900" : "text-stone-400"}`}>{label}</span>
                </div>
                {index < STEP_LABELS.length - 1 && <div className={`w-4 sm:w-8 h-px ${index < step ? "bg-emerald-500" : "bg-stone-200"}`} />}
              </div>
            ))}
          </div>
          <button data-testid="demo-exit" onClick={() => navigate("/dashboard")} className="w-8 h-8 rounded-full flex items-center justify-center text-stone-400 hover:bg-stone-100 hover:text-stone-700">
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="bg-amber-50 border-b border-amber-200 no-print">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-2 text-center text-xs font-medium text-amber-800">
          Client demo mode · Selected files stay in this browser · Demo results use sample data
        </div>
      </div>

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 pt-8 pb-24">
        {step === 0 && (
          <section className="animate-fade-in-up">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">Step 1 · Demo Capture</span>
            <h1 className="mt-2 font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-stone-900">Upload the three documents</h1>
            <p className="mt-2 text-stone-500 max-w-2xl">Upload or photograph the documents just like a real request. In demo mode, previews remain in this browser and extraction returns safe sample data.</p>
            <div className="mt-8 grid sm:grid-cols-3 gap-4">
              {DEMO_DOCUMENTS.map(({ key, icon: Icon, title, detail }) => {
                const document = documents[key];
                return (
                  <div key={key} className="relative">
                    <input
                      ref={(element) => { fileInputs.current[key] = element; }}
                      data-testid={`demo-upload-${key}`}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(event) => selectDocument(key, event.target.files?.[0])}
                    />
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => fileInputs.current[key]?.click()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          fileInputs.current[key]?.click();
                        }
                      }}
                      className={`relative min-h-64 aspect-[3/4] rounded-lg border-2 overflow-hidden flex flex-col items-center justify-center text-center cursor-pointer transition-colors shadow-sm ${document ? "border-emerald-400 bg-stone-100" : "border-dashed border-stone-300 bg-white hover:border-emerald-400 hover:bg-emerald-50/30"}`}
                    >
                      {document ? (
                        <>
                          <img src={document.preview} alt={`${title} preview`} className="absolute inset-0 w-full h-full object-contain" />
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-stone-950/90 to-transparent px-3 pt-10 pb-3 text-left">
                            <p className="truncate text-xs font-medium text-white">{document.name}</p>
                            <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-200"><CheckCircle2 className="w-3.5 h-3.5" /> Ready</span>
                          </div>
                          <button
                            type="button"
                            title={`Replace ${title}`}
                            onClick={(event) => { event.stopPropagation(); fileInputs.current[key]?.click(); }}
                            className="absolute top-2 right-2 rounded-full bg-white/95 p-2 text-stone-700 shadow hover:bg-white"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            title={`Remove ${title}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setDocuments((current) => ({ ...current, [key]: null }));
                              setDocumentsReady(false);
                              if (fileInputs.current[key]) fileInputs.current[key].value = "";
                            }}
                            className="absolute top-2 left-2 rounded-full bg-white/95 p-2 text-stone-700 shadow hover:bg-white"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <div className="p-5 flex flex-col items-center">
                          <div className="w-12 h-12 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center"><Icon className="w-6 h-6 text-emerald-700" /></div>
                          <h2 className="mt-4 font-heading font-semibold text-stone-900">{title}</h2>
                          <p className="mt-2 text-xs leading-relaxed text-stone-500">{detail}</p>
                          <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><Upload className="w-4 h-4" /> Upload / snap</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {documentsReady && (
              <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-5 grid sm:grid-cols-2 gap-3 text-sm">
                <DemoRow label="Patient" value="Jane A. Doe" /><DemoRow label="DOB" value="1979-04-12" />
                <DemoRow label="Payer" value="UnitedHealthcare" /><DemoRow label="Member ID" value="UHC998877665" />
                <DemoRow label="Diagnosis" value="M05.79" /><DemoRow label="Medication" value="Humira 40 mg" />
              </div>
            )}
            <div className="mt-8 flex items-center justify-between gap-4 flex-wrap">
              <span className="text-sm text-stone-500">{uploadedCount} of 3 documents added</span>
              {documentsReady ? (
                <Button onClick={() => setStep(1)} className="h-12 px-6 bg-emerald-900 hover:bg-emerald-800">Continue to dictation <ArrowRight className="w-4 h-4 ml-2" /></Button>
              ) : (
                <Button data-testid="demo-extract" onClick={simulateExtraction} disabled={uploadedCount === 0} className="h-12 px-6 bg-emerald-900 hover:bg-emerald-800"><Sparkles className="w-4 h-4 mr-2" /> Extract data</Button>
              )}
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="animate-fade-in-up">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">Step 2 · Demo Dictation</span>
            <h1 className="mt-2 font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-stone-900">Review the clinical narrative</h1>
            <p className="mt-2 text-stone-500 max-w-2xl">Edit this sample narrative to demonstrate how a provider can add clinical context before analysis.</p>
            <div className="mt-8 rounded-lg bg-white border border-stone-300 p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Sample narrative</span><span className="text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">Initial Auth</span></div>
              <Textarea data-testid="demo-transcript" value={transcript} onChange={(event) => setTranscript(event.target.value)} className="mt-4 min-h-[220px] resize-y leading-relaxed" />
              <p className="mt-2 text-xs text-stone-400">Demo only—this text never leaves the browser.</p>
            </div>
            <div className="mt-8 flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep(0)} className="text-stone-500"><ArrowLeft className="w-4 h-4 mr-2" /> Back</Button>
              <Button onClick={() => setStep(2)} disabled={!transcript.trim()} className="h-12 px-6 bg-emerald-900 hover:bg-emerald-800">Continue to validate <ArrowRight className="w-4 h-4 ml-2" /></Button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="animate-fade-in-up">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">Step 3 · Demo Validate</span>
            <h1 className="mt-2 font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-stone-900">Confirm codes & routing</h1>
            <p className="mt-2 text-stone-500 max-w-2xl">This realistic sample shows the payer destination and code matching without making an external request.</p>
            <div className="mt-8 grid md:grid-cols-2 gap-4">
              <DemoCard icon={Route} title="Payer destination" badge="Auto-matched">
                <p className="font-medium text-stone-800">UnitedHealthcare Provider Portal</p><p className="mt-1 text-xs text-stone-500">Electronic payer submission</p>
              </DemoCard>
              <DemoCard icon={ShieldCheck} title="Code binding" badge="96% confidence">
                <p className="font-mono font-semibold text-stone-800">M05.79 → J0135</p><p className="mt-1 text-xs text-stone-500">Rheumatoid arthritis → adalimumab injection</p>
              </DemoCard>
              <DemoCard icon={FileText} title="Quantity & duration" badge="Confirmed">
                <p className="font-medium text-stone-800">2 pens per 28 days</p><p className="mt-1 text-xs text-stone-500">Initial authorization · Office (11)</p>
              </DemoCard>
              <DemoCard icon={CheckCircle2} title="Clinical completeness" badge="Ready">
                <p className="font-medium text-stone-800">Core fields complete</p><p className="mt-1 text-xs text-stone-500">One attachment recommendation will be shown</p>
              </DemoCard>
            </div>
            <div className="mt-8 flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep(1)} className="text-stone-500"><ArrowLeft className="w-4 h-4 mr-2" /> Back</Button>
              <Button data-testid="demo-analyze" onClick={simulateAnalysis} disabled={analyzing} className="h-12 px-6 bg-emerald-900 hover:bg-emerald-800">
                {analyzing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Preparing demo…</> : <><Sparkles className="w-4 h-4 mr-2" /> Run demo analysis</>}
              </Button>
            </div>
          </section>
        )}

        {step === 3 && <ResultsStep state={{ result: DEMO_RESULT }} onExit={() => navigate("/dashboard")} />}
      </main>

      <footer className="no-print border-t border-stone-200 bg-white py-4">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex items-center justify-center"><TrustBadge label="Demo mode · sample data only · no external processing" /></div>
      </footer>
    </div>
  );
}

function DemoRow({ label, value }) {
  return <div className="flex justify-between gap-4 border-b border-emerald-100 pb-2"><span className="text-xs uppercase tracking-wider text-stone-500">{label}</span><span className="font-mono text-sm text-stone-800 text-right">{value}</span></div>;
}

function DemoCard({ icon: Icon, title, badge, children }) {
  return (
    <div className="rounded-lg bg-white border border-stone-300 p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><Icon className="w-4 h-4 text-emerald-700" /><span className="font-heading font-semibold text-sm text-stone-800">{title}</span></div>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-1">{badge}</span>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}
