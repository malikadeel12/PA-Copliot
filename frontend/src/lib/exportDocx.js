// --- Change Summary ---
// What: Client-side .DOCX export for filled PA form + medical summary.
// Why: Multi-format export alongside browser Print/PDF.
// Related: ResultsStep.js, docx npm package

import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import { saveAs } from "./saveBlob";

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    ...opts,
    children: [new TextRun({ text: text || "", ...opts.run })],
  });
}

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    heading: level,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true })],
  });
}

function kv(label, value) {
  return new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({ text: `${label}: `, bold: true }),
      new TextRun({ text: value == null || value === "" ? "—" : String(value) }),
    ],
  });
}

/** Build and download a DOCX for the filled PA form + medical necessity narrative. */
export async function downloadPaFormDocx(result, filename) {
  const form = result?.filled_form || {};
  const analysis = result?.analysis || {};
  const letter = result?.cover_letter || {};

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          heading("PA Copilot — Filled Prior Authorization Form"),
          p("Generated for submission review. Verify clinical accuracy before sending.", {
            run: { italics: true, size: 18, color: "666666" },
          }),
          heading("Patient & insurance", HeadingLevel.HEADING_2),
          kv("Patient", form.patient_name),
          kv("Date of birth", form.date_of_birth),
          kv("Payer", form.payer_name),
          kv("Member ID", form.insured_id_number),
          kv("Group / plan", form.group_plan),
          heading("Prescriber", HeadingLevel.HEADING_2),
          kv("Prescriber", form.prescriber_name),
          kv("NPI", form.prescriber_npi),
          kv("Specialty", form.specialty),
          kv("Facility", form.facility_name_address),
          heading("Service & diagnosis", HeadingLevel.HEADING_2),
          kv("Service code", form.service_code),
          kv("J-Code / NDC", form.jcode_ndc),
          kv("Primary ICD-10", form.primary_icd10),
          kv("Additional ICD-10", (form.additional_icd10 || []).join(", ")),
          kv("Quantity", form.quantity_duration),
          kv("Place of service", form.place_of_service),
          kv("Modifiers", (form.modifiers || []).join(", ")),
          kv("Request type", form.request_type),
          kv("Urgent", form.urgent_request ? "Yes" : "No"),
          kv("Urgency justification", form.urgency_justification),
          heading("Medical necessity summary", HeadingLevel.HEADING_2),
          p(form.medical_necessity_narrative || "—"),
          heading("Approval analysis", HeadingLevel.HEADING_2),
          kv(
            "Approval probability",
            (() => {
              const pct = Math.max(0, Math.min(100, analysis.approval_probability_pct ?? 0));
              const ci = Math.max(0, Math.min(25, analysis.confidence_interval_pct ?? 8));
              return `${pct}% ± ${ci}% (range ${Math.max(0, pct - ci)}–${Math.min(100, pct + ci)}%)`;
            })()
          ),
          kv("Denial risk", analysis.denial_risk),
          heading("Cover letter", HeadingLevel.HEADING_2),
          kv("To", letter.to),
          kv("Subject", letter.subject),
          p(letter.body || ""),
          p(letter.signature_block || "", { run: { italics: true } }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { before: 400 },
            children: [
              new TextRun({
                text: "Zero-database privacy · Session data is ephemeral and not retained after export.",
                size: 16,
                color: "888888",
              }),
            ],
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename || `pa-form-${Date.now()}.docx`);
}
