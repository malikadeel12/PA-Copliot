import React, { useState, useRef } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Camera, Upload, X, ScanLine, Loader2, ArrowRight,
  IdCard, CreditCard, FileText, CheckCircle2,
} from "lucide-react";

const SLOTS = [
  { key: "id", icon: IdCard, title: "Patient ID", hint: "Driver's license / gov ID — used only to confirm name & DOB, then discarded." },
  { key: "insurance", icon: CreditCard, title: "Insurance card", hint: "Front (and back). Retained as eligibility proof." },
  { key: "clinical", icon: FileText, title: "Clinical / order doc", hint: "Progress note + script/order. Signed clinical evidence." },
];

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function CaptureStep({ state, patch, onNext }) {
  const [images, setImages] = useState({ id: null, insurance: null, clinical: null });
  const [busy, setBusy] = useState(false);
  const inputs = useRef({});

  const pick = async (key, file) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast.error("Please upload an image (JPEG/PNG)."); return; }
    const dataUrl = await readAsDataURL(file);
    setImages((s) => ({ ...s, [key]: dataUrl }));
  };

  const extractedPreview = state.extractedData;
  const captured = Object.values(images).filter(Boolean).length;

  const analyze = async () => {
    const list = [images.id, images.insurance, images.clinical].filter(Boolean);
    if (list.length === 0) { toast.error("Add at least one document."); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/pa/capture", { images: list });
      patch({ requestId: data.request_id, extractedData: data.extracted_data });
      toast.success("Documents read successfully");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-in-up">
      <span className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">Step 1 · Capture</span>
      <h1 className="mt-2 font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-stone-900">Snap the three documents</h1>
      <p className="mt-2 text-stone-500 max-w-xl">Upload or photograph each document. Our vision AI reads the fields — nothing is stored after this session.</p>

      <div className="mt-8 grid sm:grid-cols-3 gap-4">
        {SLOTS.map((slot) => {
          const img = images[slot.key];
          return (
            <div key={slot.key} className="relative">
              <input
                ref={(el) => (inputs.current[slot.key] = el)}
                data-testid={`capture-input-${slot.key}`}
                type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => pick(slot.key, e.target.files?.[0])}
              />
              <button
                data-testid={`capture-slot-${slot.key}`}
                onClick={() => inputs.current[slot.key]?.click()}
                className={`relative w-full aspect-[3/4] rounded-lg overflow-hidden border-2 flex flex-col items-center justify-center text-center p-4 transition-all
                  ${img ? "border-emerald-500 bg-emerald-50/40" : "border-dashed border-stone-300 bg-white hover:border-emerald-400 hover:bg-stone-50"}`}
              >
                {img ? (
                  <>
                    <img src={img} alt={slot.title} className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-3 border-2 border-emerald-500 rounded-xl pointer-events-none" />
                    <div className="absolute top-2 right-2 bg-white rounded-full p-0.5 shadow">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    </div>
                    <button
                      data-testid={`capture-remove-${slot.key}`}
                      onClick={(e) => { e.stopPropagation(); setImages((s) => ({ ...s, [slot.key]: null })); }}
                      className="absolute top-2 left-2 bg-white/90 rounded-full p-1 shadow hover:bg-white"
                    ><X className="w-4 h-4 text-stone-700" /></button>
                  </>
                ) : (
                  <>
                    <span className="absolute top-3 left-3 w-4 h-4 border-l-2 border-t-2 border-stone-300" />
                    <span className="absolute top-3 right-3 w-4 h-4 border-r-2 border-t-2 border-stone-300" />
                    <span className="absolute bottom-3 left-3 w-4 h-4 border-l-2 border-b-2 border-stone-300" />
                    <span className="absolute bottom-3 right-3 w-4 h-4 border-r-2 border-b-2 border-stone-300" />
                    <div className="w-11 h-11 rounded-md border border-stone-200 bg-white flex items-center justify-center"><slot.icon className="w-5 h-5 text-emerald-800" /></div>
                    <span className="mt-3 font-heading font-semibold text-stone-800 text-sm">{slot.title}</span>
                    <span className="mt-1 text-[11px] text-stone-400 leading-snug">{slot.hint}</span>
                    <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700"><Upload className="w-3.5 h-3.5" /> Upload / snap</span>
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {!extractedPreview ? (
        <div className="mt-8 flex items-center justify-between gap-4 flex-wrap">
          <span className="text-sm text-stone-500">{captured} of 3 documents added</span>
          <Button data-testid="capture-analyze-btn" onClick={analyze} disabled={busy || captured === 0}
            className="h-12 px-6 bg-emerald-900 hover:bg-emerald-800 text-white font-semibold rounded-md border border-emerald-950 transition-colors">
            {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Reading documents…</> : <><ScanLine className="w-4 h-4 mr-2" /> Extract data</>}
          </Button>
        </div>
      ) : (
        <div className="mt-8 rounded-lg bg-white border border-stone-300 p-6 shadow-sm animate-fade-in-up">
          <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="w-5 h-5" /><span className="font-heading font-semibold">Extracted data</span></div>
          <ExtractedGrid data={extractedPreview} />
          <div className="mt-6 flex justify-end gap-3">
            <Button data-testid="capture-reextract-btn" variant="outline" onClick={() => patch({ extractedData: null, requestId: null })} className="h-11 rounded-xl border-stone-300">Re-scan</Button>
            <Button data-testid="capture-next-btn" onClick={onNext} className="h-11 px-6 bg-emerald-900 hover:bg-emerald-800 text-white font-semibold rounded-md border border-emerald-950 transition-colors">
              Continue to dictation <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ExtractedGrid({ data }) {
  const pi = data?.PatientInformation || {};
  const ins = data?.InsuranceInformation || {};
  const prov = data?.ProviderInformation || {};
  const diag = data?.DiagnosisInformation || {};
  const rows = [
    ["Patient", pi.PatientName], ["DOB", pi.DateOfBirth], ["Payer", ins.PayerName],
    ["Member ID", ins.InsuredIDNumber], ["Prescriber", prov.PrescriberName], ["NPI", prov.PrescriberNPI],
    ["Primary ICD-10", diag.PrimaryICD10Code], ["Request", ins.RequestType],
  ];
  return (
    <div className="mt-4 grid sm:grid-cols-2 gap-x-8 gap-y-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between border-b border-stone-100 py-1.5">
          <span className="text-xs uppercase tracking-wider text-stone-400 font-semibold">{k}</span>
          <span className="font-mono text-sm text-stone-800">{v || <span className="text-stone-300">—</span>}</span>
        </div>
      ))}
    </div>
  );
}
