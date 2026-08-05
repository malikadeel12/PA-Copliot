// --- Change Summary ---
// What: Direct .PDF download for filled PA form + medical summary (no print dialog).
// Why: Checklist polish — true Download PDF alongside DOCX / print.
// Related: ResultsStep.js, exportDocx.js, jspdf; MCP context 7 client export pattern.

import { jsPDF } from "jspdf";
import { saveAs } from "./saveBlob";

function line(doc, label, value, y, margin, maxW) {
  const text = `${label}: ${value == null || value === "" ? "—" : String(value)}`;
  const lines = doc.splitTextToSize(text, maxW);
  doc.setFont("helvetica", "bold");
  doc.text(`${label}:`, margin, y);
  const labelW = doc.getTextWidth(`${label}: `);
  doc.setFont("helvetica", "normal");
  const valueLines = doc.splitTextToSize(
    value == null || value === "" ? "—" : String(value),
    maxW - labelW
  );
  doc.text(valueLines, margin + labelW, y);
  return y + Math.max(lines.length, valueLines.length) * 5.5 + 2;
}

function ensureSpace(doc, y, need = 20) {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + need > pageH - 16) {
    doc.addPage();
    return 20;
  }
  return y;
}

function sectionTitle(doc, title, y, margin) {
  y = ensureSpace(doc, y, 14);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(30, 30, 30);
  doc.text(title, margin, y);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  return y + 8;
}

/** Build and download a PDF for the filled PA form + medical necessity narrative. */
export async function downloadPaFormPdf(result, options = {}) {
  const form = result?.filled_form || {};
  const analysis = result?.analysis || {};
  const letter = result?.cover_letter || {};
  const signatureDataUrl = options.signatureDataUrl || "";
  const filename = options.filename || `pa-form-${Date.now()}.pdf`;

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 16;
  const maxW = doc.internal.pageSize.getWidth() - margin * 2;
  let y = 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("PA Copilot — Filled Prior Authorization Form", margin, y);
  y += 7;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text("Generated for submission review. Verify clinical accuracy before sending.", margin, y);
  doc.setTextColor(30, 30, 30);
  y += 10;

  y = sectionTitle(doc, "Patient & insurance", y, margin);
  y = line(doc, "Patient", form.patient_name, y, margin, maxW);
  y = line(doc, "Date of birth", form.date_of_birth, y, margin, maxW);
  y = line(doc, "Payer", form.payer_name, y, margin, maxW);
  y = line(doc, "Member ID", form.insured_id_number, y, margin, maxW);
  y = line(doc, "Group / plan", form.group_plan, y, margin, maxW);

  y = sectionTitle(doc, "Prescriber", y, margin);
  y = line(doc, "Prescriber", form.prescriber_name, y, margin, maxW);
  y = line(doc, "NPI", form.prescriber_npi, y, margin, maxW);
  y = line(doc, "Specialty", form.specialty, y, margin, maxW);
  y = line(doc, "Facility", form.facility_name_address, y, margin, maxW);

  y = sectionTitle(doc, "Service & diagnosis", y, margin);
  y = line(doc, "Service code", form.service_code, y, margin, maxW);
  y = line(doc, "J-Code / NDC", form.jcode_ndc, y, margin, maxW);
  y = line(doc, "Primary ICD-10", form.primary_icd10, y, margin, maxW);
  y = line(doc, "Additional ICD-10", (form.additional_icd10 || []).join(", "), y, margin, maxW);
  y = line(doc, "Quantity", form.quantity_duration, y, margin, maxW);
  y = line(doc, "Place of service", form.place_of_service, y, margin, maxW);
  y = line(doc, "Modifiers", (form.modifiers || []).join(", "), y, margin, maxW);
  y = line(doc, "Request type", form.request_type, y, margin, maxW);
  y = line(doc, "Urgent", form.urgent_request ? "Yes" : "No", y, margin, maxW);
  y = line(doc, "Urgency justification", form.urgency_justification, y, margin, maxW);

  y = sectionTitle(doc, "Medical necessity summary", y, margin);
  y = ensureSpace(doc, y, 24);
  const narrative = doc.splitTextToSize(form.medical_necessity_narrative || "—", maxW);
  doc.text(narrative, margin, y);
  y += narrative.length * 5 + 6;

  y = sectionTitle(doc, "Approval analysis", y, margin);
  const pct = Math.max(0, Math.min(100, analysis.approval_probability_pct ?? 0));
  const ci = Math.max(0, Math.min(25, analysis.confidence_interval_pct ?? 8));
  y = line(
    doc,
    "Approval probability",
    `${pct}% ± ${ci}% (range ${Math.max(0, pct - ci)}–${Math.min(100, pct + ci)}%)`,
    y,
    margin,
    maxW
  );
  y = line(doc, "Denial risk", analysis.denial_risk, y, margin, maxW);

  y = sectionTitle(doc, "Cover letter", y, margin);
  y = line(doc, "To", letter.to, y, margin, maxW);
  y = line(doc, "Subject", letter.subject, y, margin, maxW);
  y = ensureSpace(doc, y, 20);
  const bodyLines = doc.splitTextToSize(letter.body || "", maxW);
  doc.text(bodyLines, margin, y);
  y += bodyLines.length * 5 + 6;

  // --- Digital signature / stamp (image preferred) ---
  y = sectionTitle(doc, "Digital signature / stamp", y, margin);
  if (typeof signatureDataUrl === "string" && signatureDataUrl.startsWith("data:image")) {
    try {
      y = ensureSpace(doc, y, 28);
      const fmt = /data:image\/(png|jpeg|jpg)/i.test(signatureDataUrl)
        ? (signatureDataUrl.includes("png") ? "PNG" : "JPEG")
        : "PNG";
      doc.addImage(signatureDataUrl, fmt, margin, y, 50, 18);
      y += 22;
    } catch {
      // Fall through to typed block if image decode fails
      const sigLines = doc.splitTextToSize(letter.signature_block || "Signature on file", maxW);
      doc.text(sigLines, margin, y);
      y += sigLines.length * 5 + 4;
    }
  } else {
    const sigText = letter.signature_block || signatureDataUrl || "—";
    const sigLines = doc.splitTextToSize(String(sigText), maxW);
    doc.setFont("helvetica", "italic");
    doc.text(sigLines, margin, y);
    doc.setFont("helvetica", "normal");
    y += sigLines.length * 5 + 4;
  }

  y = ensureSpace(doc, y, 12);
  doc.setFontSize(8);
  doc.setTextColor(136, 136, 136);
  doc.text(
    "Zero-database privacy · Session data is ephemeral and not retained after export.",
    margin,
    y
  );

  const blob = doc.output("blob");
  saveAs(blob, filename);
}
