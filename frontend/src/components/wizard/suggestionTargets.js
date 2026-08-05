// Map an AI suggestion's `target_field` (free-text from the LLM) to the
// wizard step and the data-jump-focus key for that step. The key is matched
// against `data-jump-focus="..."` on the relevant input/control so the
// receiving step can scroll + focus the right field when the user returns.
//
// Returns `null` if the field isn't recognizable — the UI then falls back
// to a generic "go back to step" message without auto-focus.

const FIELD_TO_STEP = {
  // Step 0 — Capture (editable OCR fields after extract)
  patient_name:           { step: 0, focus: "extracted-PatientName" },
  date_of_birth:          { step: 0, focus: "extracted-DateOfBirth" },
  patient_phone:          { step: 0, focus: "extracted-PatientPhone" },
  payer_name:             { step: 0, focus: "extracted-PayerName" },
  insured_id_number:      { step: 0, focus: "extracted-InsuredIDNumber" },
  member_id:              { step: 0, focus: "extracted-InsuredIDNumber" },
  group_plan:             { step: 0, focus: "extracted-GroupPlan" },
  primary_icd10:          { step: 0, focus: "extracted-PrimaryICD10Code" },
  additional_icd10:       { step: 0, focus: "extracted-PrimaryICD10Code" },
  diagnosis:              { step: 0, focus: "extracted-PrimaryICD10Code" },
  capture_rescan:         { step: 0, focus: "capture-rescan" },

  // Step 1 — Dictate (clinical narrative lives here)
  medical_necessity_narrative: { step: 1, focus: "dictation-transcript" },
  dictation:                   { step: 1, focus: "dictation-transcript" },
  narrative:                   { step: 1, focus: "dictation-transcript" },
  clinical_narrative:          { step: 1, focus: "dictation-transcript" },

  // Urgent justification is on Validate (not Dictate)
  urgency_justification:       { step: 2, focus: "validate-urgency-text" },
  urgency:                     { step: 2, focus: "validate-urgent-switch" },

  // Step 2 — Validate (everything else lives here)
  service_code:        { step: 2, focus: "validate-crosswalk" },
  jcode_ndc:           { step: 2, focus: "validate-crosswalk" },
  cpt:                 { step: 2, focus: "validate-crosswalk" },
  hcpcs:               { step: 2, focus: "validate-crosswalk" },
  modifiers:           { step: 2, focus: "validate-modifiers" },
  modifier:            { step: 2, focus: "validate-modifiers" },
  quantity_duration:   { step: 2, focus: "validate-quantity-select" },
  quantity:            { step: 2, focus: "validate-quantity-select" },
  place_of_service:    { step: 2, focus: "validate-place-select" },
  place:               { step: 2, focus: "validate-place-select" },
  urgent_request:      { step: 2, focus: "validate-urgent-switch" },
  urgent:              { step: 2, focus: "validate-urgent-switch" },
  recommended_portal:  { step: 2, focus: "validate-portal-select" },
  portal:              { step: 2, focus: "validate-portal-select" },
  request_type:        { step: 2, focus: "validate-portal-select" },
};

const STEP_LABELS = ["Capture", "Dictate", "Validate", "Package"];

export function resolveJumpTarget(targetField) {
  if (!targetField) return null;
  const key = String(targetField).trim().toLowerCase().replace(/\s+/g, "_");
  const direct = FIELD_TO_STEP[key];
  if (direct) return { ...direct, stepLabel: STEP_LABELS[direct.step] };
  // Fuzzy fallbacks: any token containing a known substring.
  for (const [pattern, target] of Object.entries(FIELD_TO_STEP)) {
    if (key.includes(pattern)) return { ...target, stepLabel: STEP_LABELS[target.step] };
  }
  return null;
}

export function getStepLabel(stepIndex) {
  return STEP_LABELS[stepIndex] || "step";
}
