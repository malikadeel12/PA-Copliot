"""PA Copilot local rule engine.

Static, versioned reference data for payer portal routing, ICD-10 -> CPT/HCPCS/NDC
code cross-walks, and modifier / quantity presets. No PHI is ever stored here.
"""

RULE_ENGINE_VERSION = "2026.06.1"
REFERENCE_LAST_UPDATED = "2026-06-01"

# ---------------------------------------------------------------------------
# 4.3.1 U.S. Payer Portal Destination Matrix
# ---------------------------------------------------------------------------
PAYER_PORTAL_MATRIX = [
    {"portal": "CoverMyMeds", "use": "Multi-payer pharmacy PA (largest ePA network)", "category": "Pharmacy"},
    {"portal": "Surescripts CompletEPA", "use": "Formulary-drug ePA transactions (NCPDP SCRIPT)", "category": "Pharmacy"},
    {"portal": "Availity Essentials", "use": "Medical / procedural / imaging PA — Elevance, many BCBS, Cigna, Humana", "category": "Medical"},
    {"portal": "UnitedHealthcare Provider Portal (Link)", "use": "Medical + Rx PA for UHC / Community Plan", "category": "Medical/Pharmacy"},
    {"portal": "OptumRx Provider Portal", "use": "Pharmacy benefit PA for Optum-managed plans", "category": "Pharmacy"},
    {"portal": "CVS Caremark / Novologix", "use": "Pharmacy PA (Caremark) & medical-benefit drug PA (Novologix)", "category": "Pharmacy/Medical"},
    {"portal": "Express Scripts / Evernorth Portal", "use": "Pharmacy benefit PA for Cigna / Express Scripts plans", "category": "Pharmacy"},
    {"portal": "Humana / CenterWell Pharmacy Portal", "use": "Pharmacy PA for Humana plans", "category": "Pharmacy"},
    {"portal": "Aetna Provider Portal (Availity / NaviNet)", "use": "Medical + pharmacy PA for Aetna plans", "category": "Medical/Pharmacy"},
    {"portal": "NaviNet (Evolent)", "use": "Multi-payer medical PA portal for several regional Blues", "category": "Medical"},
    {"portal": "eviCore Healthcare (Carelon)", "use": "Imaging, radiation oncology, MSK/spine, sleep, cardiology PA", "category": "Specialty/Imaging"},
    {"portal": "Carelon Medical Benefits Management", "use": "Specialty medical-benefit drug & procedure PA", "category": "Medical"},
    {"portal": "NIA Magellan (RadMD)", "use": "Radiology / MSK benefit management for select Blues", "category": "Imaging"},
    {"portal": "Molina Healthcare Provider Portal", "use": "Medical + pharmacy PA for Molina Medicaid / Marketplace", "category": "Medicaid/Medical"},
    {"portal": "Centene / WellCare Provider Portal", "use": "Medical + pharmacy PA for Centene-affiliated plans", "category": "Medicaid/Medical"},
    {"portal": "Rhyme / PromptPA", "use": "Multi-payer digital PA aggregators (fax-to-digital bridge)", "category": "Multi-payer"},
    {"portal": "State Medicaid FFS Portal", "use": "State-specific Medicaid fee-for-service PA", "category": "Medicaid"},
    {"portal": "Medicare Administrative Contractor (MAC) Portal", "use": "Medicare Part A/B PA for select categories", "category": "Medicare"},
    {"portal": "Direct payer fax / mail (fallback)", "use": "Used when no portal is matched or paper submission required", "category": "Fallback"},
]

# Simple payer-name -> portal fuzzy hints
_PAYER_HINTS = {
    "aetna": "Aetna Provider Portal (Availity / NaviNet)",
    "cigna": "Availity Essentials",
    "express scripts": "Express Scripts / Evernorth Portal",
    "evernorth": "Express Scripts / Evernorth Portal",
    "united": "UnitedHealthcare Provider Portal (Link)",
    "uhc": "UnitedHealthcare Provider Portal (Link)",
    "optum": "OptumRx Provider Portal",
    "caremark": "CVS Caremark / Novologix",
    "cvs": "CVS Caremark / Novologix",
    "humana": "Humana / CenterWell Pharmacy Portal",
    "anthem": "Availity Essentials",
    "elevance": "Availity Essentials",
    "blue cross": "Availity Essentials",
    "blue shield": "Availity Essentials",
    "bcbs": "Availity Essentials",
    "molina": "Molina Healthcare Provider Portal",
    "centene": "Centene / WellCare Provider Portal",
    "wellcare": "Centene / WellCare Provider Portal",
    "medicaid": "State Medicaid FFS Portal",
    "medicare": "Medicare Administrative Contractor (MAC) Portal",
}


def match_portal(payer_name: str | None, rx_bin: str | None = None) -> dict:
    """Best-effort portal match. Always overridable in the UI."""
    name = (payer_name or "").lower()
    for hint, portal in _PAYER_HINTS.items():
        if hint in name:
            match = next((p for p in PAYER_PORTAL_MATRIX if p["portal"] == portal), None)
            if match:
                return {**match, "auto_matched": True}
    return {**PAYER_PORTAL_MATRIX[0], "auto_matched": False}


# ---------------------------------------------------------------------------
# 4.3.2 Code Binding & Cross-Walk Grid (ICD-10 -> candidate procedure/drug codes)
# ---------------------------------------------------------------------------
CODE_CROSSWALK = {
    "M06.9": [{"code": "J3262", "desc": "Tocilizumab injection", "ndc": "0004-0482-XX", "confidence": 0.94, "policy": "Payer specialty-drug medical policy; LCD not applicable"}],
    "M79.7": [{"code": "20610", "desc": "Major joint injection", "ndc": None, "confidence": 0.71, "policy": "LCD — requires documented conservative trial"}],
    "E11.9": [{"code": "J1815", "desc": "Insulin injection (various)", "ndc": "varies", "confidence": 0.90, "policy": "Formulary tier + step-therapy edit"}],
    "C50.911": [{"code": "77301", "desc": "IMRT planning", "ndc": None, "confidence": 0.88, "policy": "NCD 50.1 / payer radiation-oncology medical policy"}],
    "G35": [{"code": "J2350", "desc": "Ocrelizumab injection", "ndc": "50242-150-01", "confidence": 0.86, "policy": "Payer specialty-drug policy; disease-modifying therapy"}],
    "L40.0": [{"code": "J3357", "desc": "Ustekinumab injection", "ndc": "57894-060-03", "confidence": 0.83, "policy": "Step-therapy: topical + phototherapy trial"}],
    "K50.90": [{"code": "J1745", "desc": "Infliximab injection", "ndc": "57894-030-01", "confidence": 0.85, "policy": "Step-therapy: conventional therapy failure"}],
    "J45.50": [{"code": "J2786", "desc": "Reslizumab injection", "ndc": "59310-105-01", "confidence": 0.80, "policy": "Eosinophil count threshold + ICS/LABA trial"}],
}

CONFIDENCE_AMBIGUOUS_THRESHOLD = 0.75


def crosswalk_for_icds(icd_codes: list[str]) -> list[dict]:
    rows = []
    for icd in icd_codes or []:
        key = (icd or "").strip().upper()
        candidates = CODE_CROSSWALK.get(key)
        if candidates:
            for c in candidates:
                rows.append({
                    "icd10": key,
                    "code": c["code"],
                    "description": c["desc"],
                    "ndc": c["ndc"],
                    "confidence": c["confidence"],
                    "policy": c["policy"],
                    "ambiguous": c["confidence"] < CONFIDENCE_AMBIGUOUS_THRESHOLD,
                })
        else:
            rows.append({
                "icd10": key, "code": None, "description": None, "ndc": None,
                "confidence": 0.0, "policy": "No preset cross-walk — manual code entry required",
                "ambiguous": True,
            })
    return rows


# ---------------------------------------------------------------------------
# 4.3.3 Core Quantity & Modifier presets
# ---------------------------------------------------------------------------
QUANTITY_PRESETS = [
    "30-Day Supply", "60-Day Supply", "90-Day Supply", "1 Unit / Single Procedure",
    "Acute Course: 6 Sessions", "Acute Course: 12 Sessions", "Extended Course: 24 Sessions",
    "Weekly x N weeks", "Per diem / per encounter", "Ongoing / Maintenance (annual review)",
]

MODIFIER_PRESETS = [
    {"code": "25", "meaning": "Significant, separately identifiable E/M service same day as a procedure"},
    {"code": "26", "meaning": "Professional component only"},
    {"code": "TC", "meaning": "Technical component only"},
    {"code": "50", "meaning": "Bilateral procedure"},
    {"code": "51", "meaning": "Multiple procedures"},
    {"code": "52", "meaning": "Reduced services"},
    {"code": "53", "meaning": "Discontinued procedure"},
    {"code": "59", "meaning": "Distinct procedural service"},
    {"code": "XE", "meaning": "Separate encounter (subset of 59)"},
    {"code": "XS", "meaning": "Separate structure (subset of 59)"},
    {"code": "XP", "meaning": "Separate practitioner (subset of 59)"},
    {"code": "XU", "meaning": "Unusual non-overlapping service (subset of 59)"},
    {"code": "LT", "meaning": "Left side"},
    {"code": "RT", "meaning": "Right side"},
    {"code": "76", "meaning": "Repeat procedure by same physician"},
    {"code": "77", "meaning": "Repeat procedure by another physician"},
    {"code": "78", "meaning": "Unplanned return to OR, related procedure (post-op)"},
    {"code": "79", "meaning": "Unrelated procedure during post-op period"},
    {"code": "22", "meaning": "Increased procedural services"},
    {"code": "24", "meaning": "Unrelated E/M during a post-operative period"},
    {"code": "GA", "meaning": "Waiver of liability statement on file (ABN issued)"},
    {"code": "GY", "meaning": "Item/service statutorily excluded"},
    {"code": "GZ", "meaning": "Expected to be denied, no ABN on file"},
    {"code": "KX", "meaning": "Requirements in the medical policy have been met"},
    {"code": "JW", "meaning": "Drug amount discarded / not administered"},
    {"code": "JZ", "meaning": "Zero drug wasted (single-dose container)"},
    {"code": "QW", "meaning": "CLIA-waived test"},
]

PLACE_OF_SERVICE = [
    "Inpatient", "Outpatient", "Home", "Office", "Ambulatory Surgical Center", "Telehealth",
]


def get_presets() -> dict:
    return {
        "quantity_presets": QUANTITY_PRESETS,
        "modifier_presets": MODIFIER_PRESETS,
        "place_of_service": PLACE_OF_SERVICE,
    }


def policy_context_for(codes: list[str]) -> list[dict]:
    """Return static LCD/NCD/payer-policy snippets for the involved codes."""
    ctx = []
    for row in CODE_CROSSWALK.values():
        for c in row:
            if c["code"] in (codes or []):
                ctx.append({"code": c["code"], "source": "Static reference (rule engine)", "note": c["policy"]})
    return ctx


def reference_meta() -> dict:
    return {"version": RULE_ENGINE_VERSION, "last_updated": REFERENCE_LAST_UPDATED}
