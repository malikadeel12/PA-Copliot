import React, { useState, useRef, useEffect } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Mic, MicOff, ArrowRight, ArrowLeft, Loader2, Wand2 } from "lucide-react";

const SCRIPTS = {
  Initial: "Requesting Initial Authorization for patient [Patient Name], date of birth [DOB]. The primary diagnosis is [Primary ICD-10 description]. I have prescribed [Medication/Service Name], specifically [CPT/HCPCS/J-Code], to be administered as [Dosing/Frequency/Units] at [Place of Service]. Clinical justification: [Symptoms/Staging]. Relevant labs: [Lab analyte & value]. Known allergies: [Allergies]. Previously tried and failed [Previous Medication] from [Start Date] to [End Date], discontinued due to [Clinical failure or side effect].",
  Renewal: "Requesting Renewal Authorization for patient [Patient Name], DOB [DOB], currently stable under therapy for [Primary ICD-10 description]. Ordering continuation of [Medication/Service Name], code [CPT/HCPCS/J-Code], under [Dosing/Units] at [Place of Service]. Objective response: [Quantifiable improvement metric] documented on [Date of evaluation]. No adverse reactions or allergies have occurred.",
};

export default function DictationStep({ state, patch, onBack, onNext }) {
  const requestType = state.extractedData?.InsuranceInformation?.RequestType || "Initial";
  const script = SCRIPTS[requestType] || SCRIPTS.Initial;
  const [transcript, setTranscript] = useState(state.transcript || "");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);
  const recogRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    r.onresult = (e) => {
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + " ";
      }
      if (finalText) setTranscript((prev) => (prev ? prev + " " : "") + finalText.trim());
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    recogRef.current = r;
    return () => { try { r.stop(); } catch {} };
  }, []);

  const toggle = () => {
    if (!supported) { toast.error("Voice dictation isn't supported in this browser. Type your narrative instead."); return; }
    if (listening) { recogRef.current?.stop(); setListening(false); }
    else { try { recogRef.current?.start(); setListening(true); } catch {} }
  };

  const useTemplate = () => setTranscript((prev) => (prev ? prev + "\n" : "") + script);

  const next = async () => {
    setBusy(true);
    try {
      await api.post(`/pa/${state.requestId}/dictate`, { transcript });
      patch({ transcript });
      onNext();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-in-up">
      <span className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">Step 2 · Dictate</span>
      <h1 className="mt-2 font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-stone-900">Dictate the clinical narrative</h1>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <span className="text-stone-500">Request type detected:</span>
        <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold uppercase tracking-wider border border-emerald-100">{requestType} Auth</span>
      </div>

      {/* Suggested script */}
      <div className="mt-6 rounded-2xl bg-white border border-stone-200 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Suggested script</span>
          <Button data-testid="dictation-use-template" variant="ghost" size="sm" onClick={useTemplate} className="text-emerald-700 hover:bg-emerald-50">
            <Wand2 className="w-4 h-4 mr-1.5" /> Insert template
          </Button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">
          {script.split(/(\[[^\]]+\])/g).map((part, i) =>
            part.startsWith("[") ? (
              <span key={i} className="inline-block px-1.5 py-0.5 mx-0.5 bg-amber-50 border border-amber-200 text-amber-800 rounded font-mono text-xs">{part}</span>
            ) : <span key={i}>{part}</span>
          )}
        </p>
      </div>

      {/* Recorder + transcript */}
      <div className="mt-6 rounded-2xl bg-white border border-stone-200 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Your narrative</span>
          <button data-testid="dictation-mic-btn" onClick={toggle}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all
              ${listening ? "bg-rose-50 text-rose-700 border border-rose-200" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}>
            {listening ? <><MicOff className="w-4 h-4" /> Stop</> : <><Mic className="w-4 h-4" /> Dictate</>}
            {listening && <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse-ring" />}
          </button>
        </div>
        <Textarea
          data-testid="dictation-transcript"
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Tap Dictate and speak, or type the clinical narrative here…"
          className="mt-3 min-h-[180px] resize-y font-sans text-sm leading-relaxed"
        />
        {!supported && <p className="mt-2 text-xs text-amber-600">Voice not supported here — type the narrative instead.</p>}
        <p className="mt-2 text-xs text-stone-400">Audio is never uploaded — only the resulting text is sent for analysis.</p>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <Button data-testid="dictation-back-btn" variant="ghost" onClick={onBack} className="text-stone-500"><ArrowLeft className="w-4 h-4 mr-1.5" /> Back</Button>
        <Button data-testid="dictation-next-btn" onClick={next} disabled={busy}
          className="h-12 px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl active:scale-[0.98] transition-all">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Continue to validate <ArrowRight className="w-4 h-4 ml-2" /></>}
        </Button>
      </div>
    </div>
  );
}
