// LLM services using YOUR OWN Anthropic API key (Claude for reasoning + vision OCR).
const Anthropic = require("@anthropic-ai/sdk");
const { PA_REASONING_SYSTEM_PROMPT, OCR_EXTRACTION_PROMPT } = require("./prompts");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function parseJson(text) {
  let t = (text || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(json)?/i, "").replace(/```$/g, "").trim();
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

function splitDataUrl(b64) {
  // returns { media_type, data }
  if (b64 && b64.startsWith("data:") && b64.includes(",")) {
    const [header, data] = b64.split(",", 2);
    const m = header.match(/data:(.*?);base64/);
    return { media_type: m ? m[1] : "image/jpeg", data };
  }
  return { media_type: "image/jpeg", data: b64 };
}

function textFromResponse(resp) {
  return (resp.content || []).map((b) => b.text || "").join("");
}

async function extractDocuments(imagesB64) {
  if (!imagesB64 || imagesB64.length === 0) throw new Error("No images provided");
  const content = [
    { type: "text", text: "Extract the structured JSON from these prior-authorization documents. Return JSON only." },
    ...imagesB64.filter(Boolean).map((b) => {
      const { media_type, data } = splitDataUrl(b);
      return { type: "image", source: { type: "base64", media_type, data } };
    }),
  ];
  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: OCR_EXTRACTION_PROMPT,
    messages: [{ role: "user", content }],
  });
  return parseJson(textFromResponse(resp));
}

async function runReasoning(payload) {
  const userText =
    "INPUT PAYLOAD:\n" + JSON.stringify(payload, null, 2) +
    "\n\nReturn ONLY the JSON object per the schema.";
  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: 4096,
    temperature: 0.2,
    system: PA_REASONING_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userText }],
  });
  try {
    return parseJson(textFromResponse(resp));
  } catch {
    const retry = await client().messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0,
      system: PA_REASONING_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: userText },
        { role: "assistant", content: textFromResponse(resp) },
        { role: "user", content: "Your previous reply was not valid JSON. Return ONLY the JSON object, no prose, no code fences." },
      ],
    });
    return parseJson(textFromResponse(retry));
  }
}

// --- Demo / dummy data (used when DEMO_MODE=true or the real API is unavailable) ---
function demoExtracted() {
  return {
    PatientInformation: { PatientName: "Jane A. Doe", DateOfBirth: "1979-04-12", PatientPhone: "(415) 555-0132" },
    InsuranceInformation: {
      InsuredIDNumber: "XYZ123456789", GroupPlan: "GRP-0098", RequestType: "Initial",
      RxBIN: "610279", RxPCN: "MEDDPRIME", PayerName: "Blue Shield of California",
    },
    ProviderInformation: {
      PrescriberName: "Dr. Robert Chen, MD", PrescriberNPI: "1487654321", PrescriberTaxID: "94-1234567",
      SpecialtyTaxonomy: "207RE0101X (Endocrinology)", PhoneFax: "(415) 555-0170 / (415) 555-0171",
      FacilityNameAddress: "Bay Endocrine Associates, 1200 Market St, San Francisco, CA 94102",
    },
    DiagnosisInformation: { PrimaryICD10Code: "E11.9", AdditionalICD10Codes: ["E78.5"] },
    HistoryInformation: {
      PreviousMedicationsTreatments: [
        { NameDose: "Metformin 1000mg BID", Dates: "2024-01 to 2025-10", ResultReasonForStopping: "Inadequate glycemic control (HbA1c 8.9%)" },
      ],
    },
    RelevantLabs: "HbA1c 8.9% (2025-10-02); LDL 138 mg/dL; eGFR 82",
    KnownAllergies: "None",
  };
}

function demoResult(payload) {
  const ex = (payload && payload.extracted_data) || {};
  const pat = ex.PatientInformation || {};
  const ins = ex.InsuranceInformation || {};
  const prov = ex.ProviderInformation || {};
  const diag = ex.DiagnosisInformation || {};
  const hist = ex.HistoryInformation || {};
  const prof = (payload && payload.prescriber_profile) || {};
  const conf = (payload && payload.user_confirmations) || {};
  const code = (conf.confirmed_codes && conf.confirmed_codes[0]) || {};
  const serviceCode = code.code || "J1815";
  const serviceDesc = code.description || "Insulin injection (specialty)";
  const requestType = (payload && payload.request_type) || ins.RequestType || "Initial";
  const payer = ins.PayerName || "Blue Shield of California";

  return {
    filled_form: {
      patient_name: pat.PatientName || null,
      date_of_birth: pat.DateOfBirth || null,
      patient_phone: pat.PatientPhone || null,
      insured_id_number: ins.InsuredIDNumber || null,
      group_plan: ins.GroupPlan || null,
      payer_name: payer,
      prescriber_name: prof.name || prov.PrescriberName || null,
      prescriber_npi: prof.npi || prov.PrescriberNPI || null,
      prescriber_tax_id: prov.PrescriberTaxID || null,
      specialty: prof.specialty || prov.SpecialtyTaxonomy || null,
      phone_fax: prov.PhoneFax || null,
      facility_name_address: (prof.facility_name && prof.facility_address)
        ? `${prof.facility_name}, ${prof.facility_address}` : (prov.FacilityNameAddress || null),
      service_code: serviceCode,
      jcode_ndc: code.ndc || "0003-1234-56",
      service_description: serviceDesc,
      modifiers: conf.modifiers || ["KX"],
      quantity_duration: conf.quantity || "90-Day Supply",
      date_of_service: "2026-07-15 to 2026-10-15",
      place_of_service: conf.place_of_service || "Office",
      primary_icd10: diag.PrimaryICD10Code || "E11.9",
      additional_icd10: diag.AdditionalICD10Codes || [],
      previous_treatments: (hist.PreviousMedicationsTreatments || []).map((t) => ({
        name_dose: t.NameDose || "", dates: t.Dates || "", result: t.ResultReasonForStopping || "",
      })),
      relevant_labs: ex.RelevantLabs || null,
      known_allergies: ex.KnownAllergies || "None",
      medical_necessity_narrative:
        (payload && payload.dictation_transcript) ||
        "Patient with type 2 diabetes mellitus inadequately controlled on maximally-tolerated metformin (HbA1c 8.9%). Requesting the specialty therapy per payer step-therapy policy; conservative therapy has failed to achieve glycemic targets.",
      urgent_request: false,
      urgency_justification: null,
      request_type: requestType,
    },
    analysis: {
      approval_probability_pct: 78,
      denial_risk: "Low",
      confidence_in_estimate: "Medium",
      red_flags: [
        { issue: "Signed clinical note not confirmed attached", why_it_matters: "Most payers require the signed progress note documenting failure of first-line therapy." },
      ],
      missing_items: ["Prescriber e-signature date on the attached order"],
      policy_basis: [
        { code: serviceCode, source: "Static reference (rule engine)", note: "Formulary tier + step-therapy edit; document metformin failure." },
      ],
      disclaimer: "This is a decision-support estimate, not a payer guarantee of coverage or approval.",
    },
    suggestions: [
      { priority: 1, action: "Attach the signed progress note documenting HbA1c 8.9% on metformin.", expected_impact: "High", target_field: "attachments" },
      { priority: 2, action: "Add explicit statement: 'Metformin 1000mg BID for ≥3 months with HbA1c remaining >8%.'", expected_impact: "High", target_field: "medical_necessity_narrative" },
      { priority: 3, action: "Confirm quantity matches a 90-day supply to align with payer preset.", expected_impact: "Medium", target_field: "quantity_duration" },
    ],
    cover_letter: {
      to: `${payer} — Prior Authorization Department`,
      fax_or_portal_route: "Availity Essentials (electronic PA)",
      subject: `Prior Authorization Request — ${serviceDesc} (${serviceCode})`,
      patient_line: `Patient: ${pat.PatientName || "—"}, DOB ${pat.DateOfBirth || "—"}, Member ID ${ins.InsuredIDNumber || "—"}`,
      prescriber_line: `Prescriber: ${prof.name || prov.PrescriberName || "—"}, NPI ${prof.npi || prov.PrescriberNPI || "—"}`,
      body:
        `To the Prior Authorization Reviewer,\n\nI am writing to request prior authorization for ${serviceDesc} (${serviceCode}) for the above patient, diagnosed with ${diag.PrimaryICD10Code || "E11.9"}. The patient has documented inadequate response to first-line therapy (metformin 1000mg BID) with a most recent HbA1c of 8.9%, meeting the step-therapy criteria outlined in your medical policy.\n\nGiven the documented clinical failure of conventional therapy and the ongoing risk of diabetes-related complications, this therapy is medically necessary. Supporting clinical documentation is attached.\n\nThank you for your prompt review.`,
      signature_block: `${prof.name || prov.PrescriberName || "Prescriber"}\n${prof.specialty || "Endocrinology"}\nNPI ${prof.npi || prov.PrescriberNPI || "—"}`,
    },
    submission_info: {
      recommended_portal: "Availity Essentials",
      portal_category: "Medical",
      fallback_fax_or_mail: "Direct payer fax (see plan PA form)",
      attachments_checklist: ["Insurance card (front/back)", "Signed clinical progress note", "Medication history / step-therapy documentation"],
    },
    _demo: true,
  };
}

module.exports = { extractDocuments, runReasoning, demoExtracted, demoResult };
