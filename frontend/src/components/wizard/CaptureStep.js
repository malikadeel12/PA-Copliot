import React, { useState, useRef, useEffect } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import DocumentImageEditor from "@/components/wizard/DocumentImageEditor";
import { toast } from "sonner";
import {
  Upload, X, ScanLine, Loader2, ArrowRight, Keyboard,
  IdCard, CreditCard, FileText, CheckCircle2, Crop, Plus, File as FileIcon, Image as ImageIcon,
} from "lucide-react";

const SLOTS = [
  { key: "id", icon: IdCard, title: "Patient ID", aspect: 1.586, hint: "Driver's license / gov ID — used only to confirm name & DOB, then discarded." },
  { key: "insurance", icon: CreditCard, title: "Insurance card", aspect: 1.586, hint: "Front (and back). Retained as eligibility proof." },
  { key: "clinical", icon: FileText, title: "Clinical / order doc", aspect: 0.75, hint: "Progress note + script/order. Signed clinical evidence." },
];

// Mobile (camera) input: images only.
// Desktop: images + PDF + Word + Plain Text. PDFs/DOCX/TXT skip the crop editor.
function buildAcceptAttr() {
  const isMobile = typeof window !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(window.navigator.userAgent || "");
  if (isMobile) return "image/*";
  return "image/*,application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/msword,.doc,text/plain,.txt";
}

const MANUAL_FIELDS = [
  { key: "PatientName", label: "Patient name", group: "PatientInformation", placeholder: "Jane A. Doe" },
  { key: "DateOfBirth", label: "Date of birth", group: "PatientInformation", placeholder: "1979-04-12" },
  { key: "PatientPhone", label: "Patient phone", group: "PatientInformation", placeholder: "(415) 555-0132" },
  { key: "PayerName", label: "Insurance / payer", group: "InsuranceInformation", placeholder: "UnitedHealthcare" },
  { key: "InsuredIDNumber", label: "Member ID", group: "InsuranceInformation", placeholder: "UHC998877665" },
  { key: "GroupPlan", label: "Group / plan", group: "InsuranceInformation", placeholder: "GRP-4471" },
  { key: "RequestType", label: "Request type", group: "InsuranceInformation", placeholder: "Initial" },
  { key: "PrescriberName", label: "Prescriber", group: "ProviderInformation", placeholder: "Dr. Sarah Kim, MD" },
  { key: "PrescriberNPI", label: "Prescriber NPI", group: "ProviderInformation", placeholder: "1932455678" },
  { key: "SpecialtyTaxonomy", label: "Specialty", group: "ProviderInformation", placeholder: "Rheumatology" },
  { key: "PrimaryICD10Code", label: "Primary ICD-10", group: "DiagnosisInformation", placeholder: "M05.79" },
];

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function isImageMime(mime) {
  return typeof mime === "string" && mime.startsWith("image/");
}

function isDocMime(mime) {
  if (!mime) return false;
  return (
    mime === "application/pdf" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/msword" ||
    mime === "text/plain" ||
    mime.startsWith("text/")
  );
}

function fileBadge(mime) {
  if (!mime) return { label: "FILE", Icon: FileIcon };
  if (mime === "application/pdf") return { label: "PDF", Icon: FileIcon };
  if (mime.includes("word") || mime.includes("msword")) return { label: "DOCX", Icon: FileIcon };
  if (mime.startsWith("text/")) return { label: "TXT", Icon: FileIcon };
  if (mime.startsWith("image/")) return { label: "IMG", Icon: ImageIcon };
  return { label: "FILE", Icon: FileIcon };
}

export default function CaptureStep({ state, patch, onNext }) {
  // Each slot now holds an array of file objects: { id, name, mime, kind: "image"|"doc", src?, content? }
  const [slotFiles, setSlotFiles] = useState({ id: [], insurance: [], clinical: [] });
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [editor, setEditor] = useState(null);
  const [manualMode, setManualMode] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [manual, setManual] = useState({});
  const inputs = useRef({});

  const totalFiles = Object.values(slotFiles).reduce((s, arr) => s + arr.length, 0);

  const addFileToSlot = async (key, file) => {
    if (!file) return;
    const mime = file.type || "";
    if (!isImageMime(mime) && !isDocMime(mime)) {
      toast.error("Unsupported file type. Use images, PDF, DOCX, or TXT.");
      return;
    }
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (isImageMime(mime)) {
      const dataUrl = await readAsDataURL(file);
      const slot = SLOTS.find((s) => s.key === key);
      // Insert a placeholder entry first so the editor's `onApply` callback
      // can find it by id and replace its `src`. Without this, fresh image
      // uploads were silently dropped (the map() had no matching id).
      setSlotFiles((current) => ({
        ...current,
        [key]: [...current[key], { id, name: file.name || "image.jpg", mime, kind: "image", src: dataUrl, pending: true }],
      }));
      setEditor({ key, slotKey: key, id, src: dataUrl, title: slot?.title || "document", aspect: slot?.aspect || 0.75 });
      return;
    }
    // Non-image: read as data URL, store content, no editor.
    const content = await readAsDataURL(file);
    setSlotFiles((current) => ({
      ...current,
      [key]: [...current[key], { id, name: file.name || "document", mime, kind: "doc", content }],
    }));
    toast.success(`Added ${file.name || "document"}`);
  };

  const removeFromSlot = (key, fileId) => {
    setSlotFiles((current) => ({
      ...current,
      [key]: current[key].filter((f) => f.id !== fileId),
    }));
  };

  const extractedPreview = state.extractedData;
  const captured = totalFiles;

  const analyze = async () => {
    if (totalFiles === 0) { toast.error("Add at least one document."); return; }
    // Build the multi-file payload: every file carries its slot/section so the
    // backend can tag OCR blocks appropriately.
    const files = [];
    for (const slot of SLOTS) {
      for (const f of slotFiles[slot.key]) {
        if (f.kind === "image") {
          // Image went through the crop editor and was stored in f.src.
          files.push({
            section: slot.key,
            filename: f.name || `${slot.key}.jpg`,
            mimeType: f.mime || "image/jpeg",
            content: f.src,
          });
        } else {
          files.push({
            section: slot.key,
            filename: f.name,
            mimeType: f.mime,
            content: f.content,
          });
        }
      }
    }
    setBusy(true);
    try {
      const { data } = await api.post("/pa/capture", { files });
      // New extract invalidates grids/confirmations/result so Validate refetches.
      patch({
        requestId: data.request_id,
        extractedData: data.extracted_data,
        grids: null,
        confirmations: null,
        result: null,
        transcript: "",
      });
      toast.success(`${files.length} document${files.length === 1 ? "" : "s"} read successfully`);
    } catch (e) {
      const msg = formatApiError(e.response?.data?.detail);
      if (e.response?.data?.error_code === "UNCLEAR") {
        const n = attempts + 1;
        setAttempts(n);
        if (n >= 3) {
          setManualMode(true);
          toast.error("We still couldn't read the document after 3 attempts. Please enter the details manually below.");
        } else {
          toast.error(`This document is unclear or unreadable. Please upload a clearer copy and try again. (Attempt ${n} of 3)`);
        }
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitManual = async () => {
    if (!manual.PatientName || !manual.PrimaryICD10Code) {
      toast.error("At least patient name and primary ICD-10 are required.");
      return;
    }
    const manual_data = {};
    for (const f of MANUAL_FIELDS) {
      if (!manual[f.key]) continue;
      manual_data[f.group] = manual_data[f.group] || {};
      manual_data[f.group][f.key] = manual[f.key];
    }
    setBusy(true);
    try {
      const { data } = await api.post("/pa/capture", { manual_data });
      patch({
        requestId: data.request_id,
        extractedData: data.extracted_data,
        grids: null,
        confirmations: null,
        result: null,
        transcript: "",
      });
      toast.success("Details saved");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-in-up">
      <span className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">Step 1 · Capture</span>
      <h1 className="mt-2 font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-stone-900">Add the documents</h1>
      <p className="mt-2 text-stone-500 max-w-xl">Upload one or more files per section. Handwritten or low-clarity clinical notes (images or PDFs) are routed through Claude Vision. Zero-database privacy — session data is purged on export or after 30 minutes.</p>

      <div data-jump-focus="capture-rescan" className="mt-8 grid sm:grid-cols-3 gap-4">
        {SLOTS.map((slot) => {
          const list = slotFiles[slot.key];
          return (
            <div key={slot.key} className="relative">
              <input
                ref={(el) => (inputs.current[slot.key] = el)}
                data-testid={`capture-input-${slot.key}`}
                type="file"
                accept={buildAcceptAttr()}
                multiple
                className="hidden"
                onChange={(e) => {
                  const fileList = Array.from(e.target.files || []);
                  fileList.forEach((f) => addFileToSlot(slot.key, f));
                  e.target.value = "";
                }}
              />
              <div
                role="button"
                tabIndex={0}
                data-testid={`capture-slot-${slot.key}`}
                onClick={() => inputs.current[slot.key]?.click()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputs.current[slot.key]?.click(); } }}
                className={`relative w-full aspect-[3/4] rounded-lg overflow-hidden border-2 flex flex-col items-center justify-start text-center p-4 transition-all cursor-pointer
                  ${list.length ? "border-emerald-500 bg-stone-100" : "border-dashed border-stone-300 bg-white hover:border-emerald-400 hover:bg-stone-50"}`}
              >
                <div className="absolute top-3 left-3 w-4 h-4 border-l-2 border-t-2 border-stone-300" />
                <div className="absolute top-3 right-3 w-4 h-4 border-r-2 border-t-2 border-stone-300" />
                <div className="absolute bottom-3 left-3 w-4 h-4 border-l-2 border-b-2 border-stone-300" />
                <div className="absolute bottom-3 right-3 w-4 h-4 border-r-2 border-b-2 border-stone-300" />

                <div className="w-11 h-11 rounded-md border border-stone-200 bg-white flex items-center justify-center mt-1"><slot.icon className="w-5 h-5 text-emerald-800" /></div>
                <span className="mt-3 font-heading font-semibold text-stone-800 text-sm">{slot.title}</span>
                <span className="mt-1 text-[11px] text-stone-400 leading-snug">{slot.hint}</span>

                {list.length > 0 && (
                  <div className="mt-3 w-full space-y-1.5 overflow-y-auto max-h-[40%]">
                    {list.map((f, idx) => {
                      const previewSrc = f.kind === "image" ? f.src : null;
                      const { label, Icon } = fileBadge(f.mime);
                      return (
                        <div
                          key={f.id}
                          className="flex items-center gap-2 bg-white rounded-md border border-stone-200 px-2 py-1.5 text-left"
                          data-testid={`capture-file-${slot.key}-${idx}`}
                        >
                          {previewSrc ? (
                            <button
                              type="button"
                              data-testid={`capture-expand-${slot.key}-${idx}`}
                              onClick={(e) => { e.stopPropagation(); setPreview({ src: previewSrc, title: `${slot.title} — ${f.name}` }); }}
                              className="w-9 h-9 rounded bg-stone-100 overflow-hidden flex-none border border-stone-200"
                              title="View"
                            >
                              <img src={previewSrc} alt={f.name} className="w-full h-full object-cover" />
                            </button>
                          ) : (
                            <div className="w-9 h-9 rounded bg-stone-100 flex-none border border-stone-200 flex items-center justify-center">
                              <Icon className="w-4 h-4 text-stone-600" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">{label}</div>
                            <div className="text-xs text-stone-700 truncate" title={f.name}>{f.name}</div>
                          </div>
                          {previewSrc && (
                            <button
                              type="button"
                              data-testid={`capture-edit-${slot.key}-${idx}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditor({ key: slot.key, slotKey: slot.key, id: f.id, src: previewSrc, title: slot.title, aspect: slot.aspect });
                              }}
                              className="p-1 rounded hover:bg-stone-100"
                              title="Crop"
                            >
                              <Crop className="w-3.5 h-3.5 text-stone-600" />
                            </button>
                          )}
                          <button
                            type="button"
                            data-testid={`capture-remove-${slot.key}-${idx}`}
                            onClick={(e) => { e.stopPropagation(); removeFromSlot(slot.key, f.id); }}
                            className="p-1 rounded hover:bg-stone-100"
                            title="Remove"
                          >
                            <X className="w-3.5 h-3.5 text-stone-600" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="mt-auto pt-3 w-full flex items-center justify-center gap-1.5 text-xs font-medium text-emerald-700">
                  {list.length ? (
                    <><Plus className="w-3.5 h-3.5" /> Add more</>
                  ) : (
                    <><Upload className="w-3.5 h-3.5" /> Upload / snap</>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {extractedPreview ? (
        <div className="mt-8 rounded-lg bg-white border border-stone-300 p-6 shadow-sm animate-fade-in-up">
          <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="w-5 h-5" /><span className="font-heading font-semibold">Extracted data</span></div>
          <p className="mt-1 text-sm text-stone-500">Review and correct any field before continuing — edits sync to this session only.</p>
          <ExtractedEditor
            data={extractedPreview}
            requestId={state.requestId}
            onLocalChange={(next) => patch({ extractedData: next, result: null, grids: null, confirmations: null })}
          />
          <div className="mt-6 flex justify-end gap-3">
            <Button data-testid="capture-reextract-btn" variant="outline" onClick={() => {
              patch({ extractedData: null, requestId: null, result: null, grids: null, confirmations: null, transcript: "" });
              setSlotFiles({ id: [], insurance: [], clinical: [] });
              setManualMode(false);
              setAttempts(0);
            }} className="h-11 rounded-xl border-stone-300">Re-scan</Button>
            <Button data-testid="capture-next-btn" onClick={async () => {
              // Flush pending OCR edits before leaving so Validate grids match the UI.
              if (state.requestId && state.extractedData) {
                try {
                  await api.put(`/pa/${state.requestId}/extracted`, { extracted_data: state.extractedData });
                } catch (e) {
                  toast.error(formatApiError(e.response?.data?.detail) || "Could not save OCR edits. Please retry.");
                  return;
                }
              }
              onNext();
            }} className="h-11 px-6 bg-emerald-900 hover:bg-emerald-800 text-white font-semibold rounded-md border border-emerald-950 transition-colors">
              Continue to dictation <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      ) : manualMode ? (
        <div className="mt-8 rounded-lg bg-white border border-amber-300 p-6 shadow-sm animate-fade-in-up" data-testid="manual-entry-panel">
          <div className="flex items-center gap-2 text-amber-700"><Keyboard className="w-5 h-5" /><span className="font-heading font-semibold">Enter details manually</span></div>
          <p className="mt-1 text-sm text-stone-500">We couldn't read the document after 3 attempts. Fill in the fields below (patient name and primary ICD-10 are required).</p>
          <div className="mt-4 grid sm:grid-cols-2 gap-4">
            {MANUAL_FIELDS.map((f) => (
              <div key={f.key}>
                <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">{f.label}</Label>
                <Input data-testid={`manual-${f.key}`} value={manual[f.key] || ""} placeholder={f.placeholder}
                  onChange={(e) => setManual((m) => ({ ...m, [f.key]: e.target.value }))} className="mt-1.5 h-10" />
              </div>
            ))}
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button data-testid="manual-cancel-btn" variant="outline" onClick={() => { setManualMode(false); setAttempts(0); }} className="h-11 rounded-xl border-stone-300">Back to upload</Button>
            <Button data-testid="manual-submit-btn" onClick={submitManual} disabled={busy}
              className="h-11 px-6 bg-emerald-900 hover:bg-emerald-800 text-white font-semibold rounded-md border border-emerald-950 transition-colors">
              {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : <>Save details <ArrowRight className="w-4 h-4 ml-2" /></>}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-8 flex items-center justify-between gap-4 flex-wrap">
          <span className="text-sm text-stone-500">
            {captured} file{captured === 1 ? "" : "s"} added across 3 sections{attempts > 0 ? ` · attempt ${attempts} of 3` : ""}
          </span>
          <Button data-testid="capture-analyze-btn" onClick={analyze} disabled={busy || captured === 0}
            className="h-12 px-6 bg-emerald-900 hover:bg-emerald-800 text-white font-semibold rounded-md border border-emerald-950 transition-colors">
            {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Reading documents…</> : <><ScanLine className="w-4 h-4 mr-2" /> Extract data</>}
          </Button>
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl p-2 bg-stone-900 border-stone-700" data-testid="capture-preview-dialog">
          <DialogTitle className="sr-only">{preview?.title || "Document preview"}</DialogTitle>
          <DialogDescription className="sr-only">Full-size preview of the uploaded document.</DialogDescription>
          {preview && <img src={preview.src} alt={preview.title} className="w-full max-h-[80vh] object-contain rounded" />}
        </DialogContent>
      </Dialog>

      <DocumentImageEditor
        open={!!editor}
        src={editor?.src}
        title={editor?.title}
        aspect={editor?.aspect}
        onCancel={() => {
          if (editor) {
            // If the user cancelled a fresh upload, drop the pending placeholder
            // we inserted in addFileToSlot so it doesn't linger as an empty entry.
            setSlotFiles((current) => ({
              ...current,
              [editor.slotKey]: current[editor.slotKey].filter((f) => !(f.id === editor.id && f.pending)),
            }));
          }
          setEditor(null);
        }}
        onApply={(adjustedImage) => {
          if (!editor) return;
          // Update the existing image entry in place, preserving its id and
          // clearing the pending flag now that the doctor confirmed the crop.
          setSlotFiles((current) => ({
            ...current,
            [editor.slotKey]: current[editor.slotKey].map((f) =>
              f.id === editor.id ? { ...f, src: adjustedImage, mime: "image/jpeg", kind: "image", name: f.name || "cropped.jpg", pending: false } : f
            ),
          }));
          setEditor(null);
          toast.success("Document crop saved");
        }}
      />
    </div>
  );
}

// Editable OCR review — users correct parsed fields before the next step.
const EDIT_FIELDS = [
  { group: "PatientInformation", key: "PatientName", label: "Patient name" },
  { group: "PatientInformation", key: "DateOfBirth", label: "DOB" },
  { group: "PatientInformation", key: "PatientPhone", label: "Phone" },
  { group: "InsuranceInformation", key: "PayerName", label: "Payer" },
  { group: "InsuranceInformation", key: "InsuredIDNumber", label: "Member ID" },
  { group: "InsuranceInformation", key: "GroupPlan", label: "Group / plan" },
  { group: "InsuranceInformation", key: "RequestType", label: "Request type" },
  { group: "ProviderInformation", key: "PrescriberName", label: "Prescriber" },
  { group: "ProviderInformation", key: "PrescriberNPI", label: "NPI" },
  { group: "DiagnosisInformation", key: "PrimaryICD10Code", label: "Primary ICD-10" },
];

function ExtractedEditor({ data, requestId, onLocalChange }) {
  const syncTimer = useRef(null);
  const latestRef = useRef(data);
  latestRef.current = data;

  useEffect(() => () => { if (syncTimer.current) clearTimeout(syncTimer.current); }, []);

  const setField = (group, key, value) => {
    const next = {
      ...latestRef.current,
      [group]: { ...(latestRef.current?.[group] || {}), [key]: value },
    };
    latestRef.current = next;
    onLocalChange(next);
    // Debounce server sync so rapid typing doesn't race older PUTs.
    if (syncTimer.current) clearTimeout(syncTimer.current);
    if (!requestId) return;
    syncTimer.current = setTimeout(async () => {
      try {
        await api.put(`/pa/${requestId}/extracted`, { extracted_data: latestRef.current });
      } catch (e) {
        toast.error(formatApiError(e.response?.data?.detail) || "Could not save OCR edits — check your connection.");
      }
    }, 450);
  };

  return (
    <div className="mt-4 grid sm:grid-cols-2 gap-3" data-testid="extracted-editor" data-jump-focus="capture-rescan">
      {EDIT_FIELDS.map((f) => (
        <div key={`${f.group}.${f.key}`}>
          <Label className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">{f.label}</Label>
          <Input
            data-testid={`extracted-${f.key}`}
            data-jump-focus={`extracted-${f.key}`}
            value={data?.[f.group]?.[f.key] || ""}
            onChange={(e) => setField(f.group, f.key, e.target.value)}
            className="mt-1 h-10 font-mono text-sm"
          />
        </div>
      ))}
    </div>
  );
}
